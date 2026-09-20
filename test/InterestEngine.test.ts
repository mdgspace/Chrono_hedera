import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { type InterestEngine, type MockLendingPool, type AssetRegistry } from "../typechain-types";
import { type SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("InterestEngine", function () {
    let engine: InterestEngine;
    let mockPool: MockLendingPool;
    let registry: AssetRegistry;
    let owner: SignerWithAddress;
    let vault: SignerWithAddress;
    
    const TOKEN_STABLE = "0x0000000000000000000000000000000000000001";
    const TOKEN_VOLATILE = "0x0000000000000000000000000000000000000002";
    const POS_ID = "0x1234567890123456789012345678901234567890123456789012345678901234";

    beforeEach(async function () {
        [owner, vault] = await ethers.getSigners();
        
        const RegistryFactory = await ethers.getContractFactory("AssetRegistry");
        registry = await RegistryFactory.deploy(owner.address) as any;
        
        const PoolFactory = await ethers.getContractFactory("MockLendingPool");
        mockPool = await PoolFactory.deploy() as any;

        const EngineFactory = await ethers.getContractFactory("InterestEngine");
        engine = await EngineFactory.deploy(await mockPool.getAddress(), await registry.getAddress(), owner.address) as any;

        await engine.setAuthorized(vault.address, true);

        // Register Stablecoin
        await registry.registerAsset({
            tokenAddress: TOKEN_STABLE,
            decimals: 8,
            isStablecoin: true,
            ltvBase: 0, ltvMax: 0, kDecay: 0, liquidationBonus: 0, closeFactor: 0,
            ltBufferMin: 0, ltBufferMax: 0, kLtBuffer: 0, hardLiqPenalty: 0,
            minBorrowDuration: 0, maxBorrowDuration: 0, isActive: false
        });

        // Register Volatile
        await registry.registerAsset({
            tokenAddress: TOKEN_VOLATILE,
            decimals: 8,
            isStablecoin: false,
            ltvBase: 0, ltvMax: 0, kDecay: 0, liquidationBonus: 0, closeFactor: 0,
            ltBufferMin: 0, ltBufferMax: 0, kLtBuffer: 0, hardLiqPenalty: 0,
            minBorrowDuration: 0, maxBorrowDuration: 0, isActive: false
        });
    });

    it("should compute utilization correctly", async function () {
        await mockPool.setDeposits(TOKEN_STABLE, ethers.parseUnits("1000", 18));
        await mockPool.setBorrowed(TOKEN_STABLE, ethers.parseUnits("500", 18));

        const u = await engine.getUtilization(TOKEN_STABLE);
        expect(u).to.equal(ethers.parseUnits("0.5", 18));
    });

    it("should compute stablecoin borrow APY correctly (below optimal)", async function () {
        // U = 45% (below 90% optimal)
        await mockPool.setDeposits(TOKEN_STABLE, ethers.parseUnits("1000", 18));
        await mockPool.setBorrowed(TOKEN_STABLE, ethers.parseUnits("450", 18));

        // formula: rate = rBase + (U/Uopt) * rSlope1
        // rBase = 0.5%, U/Uopt = 0.5, rSlope1 = 4%
        // rate = 0.5% + 0.5 * 4% = 2.5%
        const rate = await engine.getBorrowAPY(TOKEN_STABLE);
        expect(rate).to.equal(ethers.parseUnits("0.025", 18));
    });

    it("should compute stablecoin borrow APY correctly (above optimal)", async function () {
        // U = 95% (above 90% optimal)
        await mockPool.setDeposits(TOKEN_STABLE, ethers.parseUnits("1000", 18));
        await mockPool.setBorrowed(TOKEN_STABLE, ethers.parseUnits("950", 18));

        // formula: rate = rBase + rSlope1 + ((U-Uopt)/(1-Uopt)) * rSlope2
        // rBase = 0.5%, rSlope1 = 4%, (95-90)/(100-90) = 0.5, rSlope2 = 60%
        // rate = 4.5% + 0.5 * 60% = 34.5%
        const rate = await engine.getBorrowAPY(TOKEN_STABLE);
        expect(rate).to.equal(ethers.parseUnits("0.345", 18));
    });

    it("should compute supply APY correctly", async function () {
        // U = 45%, Borrow APY = 2.5%
        await mockPool.setDeposits(TOKEN_STABLE, ethers.parseUnits("1000", 18));
        await mockPool.setBorrowed(TOKEN_STABLE, ethers.parseUnits("450", 18));

        // Supply APY = Borrow APY * U * (1 - protocolFee)
        // Supply APY = 2.5% * 0.45 * (1 - 0.10) = 0.025 * 0.45 * 0.9 = 0.010125 (1.0125%)
        const rate = await engine.getSupplyAPY(TOKEN_STABLE);
        expect(rate).to.equal(ethers.parseUnits("0.010125", 18));
    });

    it("should init position and accrue interest over time", async function () {
        const principal = ethers.parseUnits("1000", 18);
        await engine.connect(vault).initPosition(POS_ID, TOKEN_STABLE, principal);

        // U = 45%, Borrow APY = 2.5%
        await mockPool.setDeposits(TOKEN_STABLE, ethers.parseUnits("1000", 18));
        await mockPool.setBorrowed(TOKEN_STABLE, ethers.parseUnits("450", 18));

        // Fast forward 1 year
        const ONE_YEAR = 31536000;
        await time.increase(ONE_YEAR);

        await engine.connect(vault).accrueInterest(POS_ID);

        const pos = await engine.positions(POS_ID);
        // Continuous compounding via PRBMath exp(rt): e^(0.025) ≈ 1.0253151205...
        // Accrued = 1000 * (e^0.025 - 1) ≈ 25.31512...
        expect(pos.accruedInterest).to.be.closeTo(ethers.parseUnits("25.31512", 18), ethers.parseUnits("0.001", 18));
    });

    it("should allow partial repay updates", async function () {
        await engine.connect(vault).initPosition(POS_ID, TOKEN_STABLE, ethers.parseUnits("1000", 18));
        await engine.connect(vault).updateAfterRepay(POS_ID, ethers.parseUnits("500", 18), ethers.parseUnits("10", 18));
        
        const pos = await engine.positions(POS_ID);
        expect(pos.principal).to.equal(ethers.parseUnits("500", 18));
        expect(pos.accruedInterest).to.equal(ethers.parseUnits("10", 18));
    });

    it("should clear position", async function () {
        await engine.connect(vault).initPosition(POS_ID, TOKEN_STABLE, ethers.parseUnits("1000", 18));
        await engine.connect(vault).clearPosition(POS_ID);
        const pos = await engine.positions(POS_ID);
        expect(pos.principal).to.equal(0n);
        expect(pos.debtToken).to.equal(ethers.ZeroAddress);
    });

    it("should revert if unauthorized caller tries to mutate", async function () {
        await expect(engine.connect(owner).initPosition(POS_ID, TOKEN_STABLE, 100))
            .to.be.revertedWithCustomError(engine, "Unauthorized")
            .withArgs(owner.address, ethers.ZeroAddress);
    });
});
