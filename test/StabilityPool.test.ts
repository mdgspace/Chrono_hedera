import { expect } from "chai";
import { ethers } from "hardhat";
import { StabilityPool, MockERC20 } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("StabilityPool", function () {
    let stabilityPool: StabilityPool;
    let wBTC: MockERC20;
    let wUSDC: MockERC20;
    let owner: HardhatEthersSigner;
    let provider1: HardhatEthersSigner;
    let provider2: HardhatEthersSigner;
    let liquidationEngine: HardhatEthersSigner;

    const WAD = 10n ** 18n;

    beforeEach(async function () {
        [owner, provider1, provider2, liquidationEngine] = await ethers.getSigners();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        wBTC = await MockERC20.deploy("Wrapped BTC", "wBTC", 8);
        wUSDC = await MockERC20.deploy("Wrapped USDC", "wUSDC", 8);

        const StabilityPool = await ethers.getContractFactory("StabilityPool");
        stabilityPool = await StabilityPool.deploy();

        await stabilityPool.setLiquidationEngine(liquidationEngine.address);

        // Mint and approve
        await wUSDC.mint(provider1.address, 1000n * WAD);
        await wUSDC.mint(provider2.address, 1000n * WAD);
        await wBTC.mint(liquidationEngine.address, 10n * WAD);

        await wUSDC.connect(provider1).approve(await stabilityPool.getAddress(), ethers.MaxUint256);
        await wUSDC.connect(provider2).approve(await stabilityPool.getAddress(), ethers.MaxUint256);
        await wBTC.connect(liquidationEngine).approve(await stabilityPool.getAddress(), ethers.MaxUint256);
    });

    it("should allow deposits and update scale correctly", async function () {
        await stabilityPool.connect(provider1).deposit(await wUSDC.getAddress(), 100n * WAD);
        
        expect(await stabilityPool.canAbsorb(await wUSDC.getAddress(), 100n * WAD)).to.be.true;
        expect(await stabilityPool.canAbsorb(await wUSDC.getAddress(), 101n * WAD)).to.be.false;
        
        const scale = await stabilityPool.depositScale(await wUSDC.getAddress());
        expect(scale).to.equal(WAD);
    });

    it("should process debt absorption correctly", async function () {
        const poolAddr = await stabilityPool.getAddress();
        const usdcAddr = await wUSDC.getAddress();
        const btcAddr = await wBTC.getAddress();

        await stabilityPool.connect(provider1).deposit(usdcAddr, 100n * WAD);
        await stabilityPool.connect(provider2).deposit(usdcAddr, 100n * WAD);

        // Pool has 200 USDC.
        // LiquidationEngine absorbs 50 USDC debt, providing 1 WBTC collateral
        await wBTC.connect(liquidationEngine).transfer(poolAddr, 1n * WAD);
        await stabilityPool.connect(liquidationEngine).absorbDebt(usdcAddr, 50n * WAD, btcAddr, 1n * WAD);

        // Scale should decrease. 150 / 200 = 0.75
        const scale = await stabilityPool.depositScale(usdcAddr);
        expect(scale).to.equal((75n * WAD) / 100n); // 0.75 WAD

        // provider1 should have 75 USDC
        await stabilityPool.connect(provider1).withdraw(usdcAddr, 75n * WAD);
        const p1Bal = await wUSDC.balanceOf(provider1.address);
        expect(p1Bal).to.equal(1000n * WAD - 25n * WAD); // Initial 1000 - 100 dep + 75 withdraw
    });

    it("should distribute collateral rewards pro-rata", async function () {
        const poolAddr = await stabilityPool.getAddress();
        const usdcAddr = await wUSDC.getAddress();
        const btcAddr = await wBTC.getAddress();

        // P1 deposits 100, P2 deposits 200
        await stabilityPool.connect(provider1).deposit(usdcAddr, 100n * WAD);
        await stabilityPool.connect(provider2).deposit(usdcAddr, 200n * WAD);

        // Liquidation Engine transfers 3 wBTC collateral and absorbs 60 wUSDC debt
        await wBTC.connect(liquidationEngine).transfer(poolAddr, 3n * WAD);
        await stabilityPool.connect(liquidationEngine).absorbDebt(usdcAddr, 60n * WAD, btcAddr, 3n * WAD);

        // Claim rewards
        await stabilityPool.connect(provider1).claimCollateralRewards(usdcAddr);
        await stabilityPool.connect(provider2).claimCollateralRewards(usdcAddr);

        // P1 gets 1/3 (1 wBTC), P2 gets 2/3 (2 wBTC)
        expect(await wBTC.balanceOf(provider1.address)).to.equal(1n * WAD);
        expect(await wBTC.balanceOf(provider2.address)).to.equal(2n * WAD);
    });

    it("should handle multiple absorptions and late deposits correctly", async function () {
        const poolAddr = await stabilityPool.getAddress();
        const usdcAddr = await wUSDC.getAddress();
        const btcAddr = await wBTC.getAddress();

        // P1 deposits 100
        await stabilityPool.connect(provider1).deposit(usdcAddr, 100n * WAD);

        // Absorb 1: 50 USDC debt, 1 WBTC collateral
        await wBTC.connect(liquidationEngine).transfer(poolAddr, 1n * WAD);
        await stabilityPool.connect(liquidationEngine).absorbDebt(usdcAddr, 50n * WAD, btcAddr, 1n * WAD);
        
        // P2 deposits 150
        await stabilityPool.connect(provider2).deposit(usdcAddr, 150n * WAD);

        // Absorb 2: 100 USDC debt, 4 WBTC collateral
        await wBTC.connect(liquidationEngine).transfer(poolAddr, 4n * WAD);
        await stabilityPool.connect(liquidationEngine).absorbDebt(usdcAddr, 100n * WAD, btcAddr, 4n * WAD);

        await stabilityPool.connect(provider1).claimCollateralRewards(usdcAddr);
        await stabilityPool.connect(provider2).claimCollateralRewards(usdcAddr);

        // P1 share of Absorb 1: 100% of 1 WBTC = 1 WBTC. 
        // Real deposits before Absorb 2: P1=50, P2=150 (Total 200)
        // P1 share of Absorb 2: 50/200 = 25% of 4 WBTC = 1 WBTC. Total = 2 WBTC.
        // P2 share of Absorb 2: 150/200 = 75% of 4 WBTC = 3 WBTC. Total = 3 WBTC.
        
        expect(await wBTC.balanceOf(provider1.address)).to.equal(2n * WAD);
        expect(await wBTC.balanceOf(provider2.address)).to.equal(3n * WAD);

        // Check real deposits
        // P1 real deposit = 50 - (50/200 * 100) = 50 - 25 = 25
        // P2 real deposit = 150 - (150/200 * 100) = 150 - 75 = 75
        
        await stabilityPool.connect(provider1).withdraw(usdcAddr, 25n * WAD);
        await stabilityPool.connect(provider2).withdraw(usdcAddr, 75n * WAD);

        const poolBal = await wUSDC.balanceOf(poolAddr);
        // We might have tiny dust left from rounding, but it should be extremely close to 0
        expect(poolBal).to.be.lt(10n);
    });
});
