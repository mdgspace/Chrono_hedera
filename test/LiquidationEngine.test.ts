import { expect } from "chai";
import { ethers, network } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("LiquidationEngine", function () {
    let liquidationEngine: any;
    let borrowVault: any;
    let assetRegistry: any;
    let lendingPool: any;
    let oracle: any;
    let riskEngine: any;
    let interestEngine: any;
    let schedulerEngine: any;
    let stabilityPool: any;
    
    let owner: HardhatEthersSigner;
    let borrower: HardhatEthersSigner;
    let liquidator: HardhatEthersSigner;

    let wUSDC: any;
    let wBTC: any;

    beforeEach(async function () {
        [owner, borrower, liquidator] = await ethers.getSigners();

        // Mocks for ERC20
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        wUSDC = await MockERC20.deploy("Wrapped USDC", "wUSDC", 8);
        wBTC = await MockERC20.deploy("Wrapped BTC", "wBTC", 8);

        // Core contracts
        const AssetRegistry = await ethers.getContractFactory("AssetRegistry");
        assetRegistry = await AssetRegistry.deploy(owner.address);
        
        await assetRegistry.registerAsset({
            tokenAddress: await wUSDC.getAddress(),
            decimals: 8,
            isStablecoin: true,
            ltvBase: ethers.parseUnits("0.8", 18),
            ltvMax: ethers.parseUnits("0.97", 18),
            kDecay: 7614000000000n,
            liquidationBonus: ethers.parseUnits("0.03", 18), // 3%
            closeFactor: ethers.parseUnits("0.5", 18), // 50% max close
            ltBufferMin: ethers.parseUnits("0.05", 18),
            ltBufferMax: ethers.parseUnits("0.25", 18),
            kLtBuffer: 7614000000000n,
            hardLiqPenalty: ethers.parseUnits("0.05", 18),
            minBorrowDuration: 3600,
            maxBorrowDuration: 2592000,
            isActive: true
        });

        await assetRegistry.registerAsset({
            tokenAddress: await wBTC.getAddress(),
            decimals: 8,
            isStablecoin: false,
            ltvBase: ethers.parseUnits("0.5", 18),
            ltvMax: ethers.parseUnits("0.8", 18),
            kDecay: 7614000000000n,
            liquidationBonus: ethers.parseUnits("0.06", 18), // 6%
            closeFactor: ethers.parseUnits("0.5", 18), // 50% max close
            ltBufferMin: ethers.parseUnits("0.05", 18),
            ltBufferMax: ethers.parseUnits("0.25", 18),
            kLtBuffer: 7614000000000n,
            hardLiqPenalty: ethers.parseUnits("0.1", 18),
            minBorrowDuration: 3600,
            maxBorrowDuration: 2592000,
            isActive: true
        });

        const LendingPool = await ethers.getContractFactory("LendingPool");
        lendingPool = await LendingPool.deploy(await assetRegistry.getAddress(), owner.address);

        const InterestEngine = await ethers.getContractFactory("InterestEngine");
        interestEngine = await InterestEngine.deploy(await lendingPool.getAddress(), await assetRegistry.getAddress(), owner.address);

        const RiskEngine = await ethers.getContractFactory("RiskEngine");
        riskEngine = await RiskEngine.deploy(await assetRegistry.getAddress());

        const StabilityPool = await ethers.getContractFactory("StabilityPool");
        stabilityPool = await StabilityPool.deploy();

        const MockOracle = await ethers.getContractFactory("MockOracleAdapter");
        oracle = await MockOracle.deploy();
        // BTC = 60000, USDC = 1 (prices must be in WAD for the system)
        await oracle.setPrice(await wBTC.getAddress(), ethers.parseUnits("60000", 18), 8);
        await oracle.setPrice(await wUSDC.getAddress(), ethers.parseUnits("1", 18), 8);

        const MockScheduler = await ethers.getContractFactory("MockSchedulerEngine");
        schedulerEngine = await MockScheduler.deploy();

        const LiquidationEngine = await ethers.getContractFactory("LiquidationEngine");
        liquidationEngine = await LiquidationEngine.deploy();

        const BorrowVault = await ethers.getContractFactory("BorrowVault");
        borrowVault = await BorrowVault.deploy();

        // Initializations
        await borrowVault.initialize(
            await assetRegistry.getAddress(),
            await riskEngine.getAddress(),
            await oracle.getAddress(),
            await lendingPool.getAddress(),
            await interestEngine.getAddress(),
            await schedulerEngine.getAddress(),
            await liquidationEngine.getAddress()
        );

        await liquidationEngine.initialize(
            await oracle.getAddress(),
            await assetRegistry.getAddress(),
            await interestEngine.getAddress(),
            await riskEngine.getAddress(),
            await stabilityPool.getAddress(),
            await borrowVault.getAddress(),
            await lendingPool.getAddress()
        );

        await stabilityPool.setLiquidationEngine(await liquidationEngine.getAddress());

        await lendingPool.setAuthorized(await borrowVault.getAddress(), true);
        await lendingPool.setAuthorized(await liquidationEngine.getAddress(), true);
        
        await interestEngine.setAuthorized(await borrowVault.getAddress(), true);
        await interestEngine.setAuthorized(await liquidationEngine.getAddress(), true);

        // Setup Liquidity
        await wUSDC.mint(owner.address, 1000000n * 10n**8n);
        await wUSDC.approve(await lendingPool.getAddress(), ethers.MaxUint256);
        await lendingPool.deposit(await wUSDC.getAddress(), 1000000n * 10n**8n, owner.address);
    });

    it("should allow soft liquidation if health factor drops", async function () {
        const colToken = await wBTC.getAddress();
        const debtToken = await wUSDC.getAddress();
        
        const colAmount = 1n * 10n**8n; // 1 BTC
        const borrowAmount = 35000n * 10n**8n; // 35k USDC
        const duration = 86400;

        await wBTC.mint(borrower.address, colAmount);
        await wBTC.connect(borrower).approve(await borrowVault.getAddress(), ethers.MaxUint256);

        const tx = await borrowVault.connect(borrower).openPosition(
            borrower.address,
            colToken,
            debtToken,
            colAmount,
            borrowAmount,
            duration
        );
        const receipt = await tx.wait();
        const posId = receipt.logs.find((l: any) => l.fragment?.name === "PositionOpened").args.positionId;

        // Price of BTC drops to $45k
        await oracle.setPrice(colToken, ethers.parseUnits("45000", 18), 8);

        // Calculate expected liquidation
        // Repay amount: try to repay 20k, but max close factor is 50%.
        // Total debt = 35k USDC. Max repay = 17.5k USDC.
        const repayAmount = 20000n * 10n**8n;
        const maxRepay = 17500n * 10n**8n;
        
        await wUSDC.mint(liquidator.address, repayAmount);
        await wUSDC.connect(liquidator).approve(await liquidationEngine.getAddress(), ethers.MaxUint256);

        const preColBal = await wBTC.balanceOf(liquidator.address);
        
        await liquidationEngine.connect(liquidator).softLiquidate(posId, repayAmount);

        const postColBal = await wBTC.balanceOf(liquidator.address);
        
        // Seized collateral = (maxRepay * debtPrice * 1.06) / colPrice
        // (17500 * 1 * 1.06) / 45000 = 18550 / 45000 = 0.41222222 BTC
        const expectedSeized = (maxRepay * 10n**8n * 106n) / (45000n * 10n**8n * 100n);
        
        expect(postColBal - preColBal).to.equal(expectedSeized);
    });

    it("should execute hard liquidation correctly after expiry", async function () {
        const colToken = await wBTC.getAddress();
        const debtToken = await wUSDC.getAddress();
        
        const colAmount = 1n * 10n**8n; // 1 BTC
        const borrowAmount = 40000n * 10n**8n; // 40k USDC
        const duration = 3600; // 1 hr

        await wBTC.mint(borrower.address, colAmount);
        await wBTC.connect(borrower).approve(await borrowVault.getAddress(), ethers.MaxUint256);

        const tx = await borrowVault.connect(borrower).openPosition(
            borrower.address,
            colToken,
            debtToken,
            colAmount,
            borrowAmount,
            duration
        );
        const receipt = await tx.wait();
        const posId = receipt.logs.find((l: any) => l.fragment?.name === "PositionOpened").args.positionId;

        // Fast forward past expiry
        await network.provider.send("evm_increaseTime", [duration + 10]);
        await network.provider.send("evm_mine");

        // Hard liquidate
        // Owner/treasury will receive the penalty collateral. Let's check borrower's returned collateral
        const preColBal = await wBTC.balanceOf(borrower.address);
        
        await liquidationEngine.executeHardLiquidation(posId);
        
        const postColBal = await wBTC.balanceOf(borrower.address);
        
        // Debt = 40,000. Interest approx 0.
        // Debt equivalent in BTC: 40000 / 60000 = 0.66666666 BTC
        // Penalty = 5% (from wUSDC config). 0.66666666 * 1.05 = 0.70 BTC seized.
        // Borrower should receive 1 - 0.70 = 0.30 BTC returned.
        const returned = postColBal - preColBal;
        expect(returned).to.be.greaterThan(29000000n); // 0.29 BTC
        expect(returned).to.be.lessThan(31000000n); // 0.31 BTC
    });
});
