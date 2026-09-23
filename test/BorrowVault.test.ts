import { expect } from "chai";
import { ethers, network } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("BorrowVault", function () {
    let borrowVault: any;
    let assetRegistry: any;
    let lendingPool: any;
    let oracle: any;
    let riskEngine: any;
    let interestEngine: any;
    let schedulerEngine: any;
    
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

        // Core contracts (we can use real ones for registry, risk, interest, lending, but mock oracle and scheduler)
        const AssetRegistry = await ethers.getContractFactory("AssetRegistry");
        assetRegistry = await AssetRegistry.deploy(owner.address);
        
        await assetRegistry.registerAsset({
            tokenAddress: await wUSDC.getAddress(),
            decimals: 8,
            isStablecoin: true,
            ltvBase: ethers.parseUnits("0.8", 18),
            ltvMax: ethers.parseUnits("0.97", 18),
            kDecay: 7614000000000n,
            liquidationBonus: ethers.parseUnits("0.03", 18),
            closeFactor: ethers.parseUnits("0.5", 18),
            ltBufferMin: ethers.parseUnits("0.05", 18),
            ltBufferMax: ethers.parseUnits("0.25", 18),
            kLtBuffer: 7614000000000n,
            hardLiqPenalty: ethers.parseUnits("0.05", 18),
            hardLiqCollateralFloor: 0n,
            stabilityPoolPenaltyShare: 0n,
            reservePenaltyShare: 0n,
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
            liquidationBonus: ethers.parseUnits("0.06", 18),
            closeFactor: ethers.parseUnits("0.5", 18),
            ltBufferMin: ethers.parseUnits("0.05", 18),
            ltBufferMax: ethers.parseUnits("0.25", 18),
            kLtBuffer: 7614000000000n,
            hardLiqPenalty: ethers.parseUnits("0.1", 18),
            hardLiqCollateralFloor: 0n,
            stabilityPoolPenaltyShare: 0n,
            reservePenaltyShare: 0n,
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

        // Mock Oracle
        const MockOracle = await ethers.getContractFactory("MockOracleAdapter");
        oracle = await MockOracle.deploy();
        // set prices: BTC = 60000, USDC = 1
        await oracle.setPrice(await wBTC.getAddress(), ethers.parseUnits("60000", 18), 8);
        await oracle.setPrice(await wUSDC.getAddress(), ethers.parseUnits("1", 18), 8);

        // Mock Scheduler
        const MockScheduler = await ethers.getContractFactory("MockSchedulerEngine");
        schedulerEngine = await MockScheduler.deploy();

        const BorrowVault = await ethers.getContractFactory("BorrowVault");
        borrowVault = await BorrowVault.deploy();

        await borrowVault.initialize(
            await assetRegistry.getAddress(),
            await riskEngine.getAddress(),
            await oracle.getAddress(),
            await lendingPool.getAddress(),
            await interestEngine.getAddress(),
            await schedulerEngine.getAddress(),
            liquidator.address // mock liquidation engine
        );

        await lendingPool.setAuthorized(await borrowVault.getAddress(), true);
        await interestEngine.setAuthorized(await borrowVault.getAddress(), true);

        // Fund lending pool with USDC
        await wUSDC.mint(owner.address, 100000n * 10n**8n);
        await wUSDC.approve(await lendingPool.getAddress(), 100000n * 10n**8n);
        await lendingPool.deposit(await wUSDC.getAddress(), 100000n * 10n**8n, owner.address);

        // Give borrower collateral
        await wBTC.mint(borrower.address, 10n * 10n**8n); // 10 BTC
        await wBTC.connect(borrower).approve(await borrowVault.getAddress(), ethers.MaxUint256);
    });

    it("should allow opening a position and return positionId", async function () {
        const colToken = await wBTC.getAddress();
        const debtToken = await wUSDC.getAddress();
        
        // Col: 1 BTC ($60k). Debt: 30k USDC. LTV = 50%.
        const colAmount = 1n * 10n**8n;
        const borrowAmount = 30000n * 10n**8n;
        const duration = 86400; // 1 day

        const tx = await borrowVault.connect(borrower).openPosition(
            borrower.address,
            colToken,
            debtToken,
            colAmount,
            borrowAmount,
            duration
        );
        
        const receipt = await tx.wait();
        const event = receipt.logs.find((l: any) => l.fragment?.name === "PositionOpened");
        expect(event).to.not.be.undefined;

        // Position details
        const pos = await borrowVault.getPosition(event.args.positionId);
        expect(pos.borrower).to.equal(borrower.address);
        expect(pos.collateralAmount).to.equal(colAmount);
        expect(pos.borrowAmount).to.equal(borrowAmount);
        expect(pos.active).to.be.true;
    });

    it("should revert if LTV exceeds max LTV", async function () {
        const colToken = await wBTC.getAddress();
        const debtToken = await wUSDC.getAddress();
        
        // Col: 1 BTC ($60k). Debt: 50k USDC. LTV = 83% > maxLTV for 1 day
        const colAmount = 1n * 10n**8n;
        const borrowAmount = 50000n * 10n**8n;
        const duration = 86400; // 1 day
        
        // Max LTV for 1 day is between 0.8 and 0.5. At 1 day, it's roughly 0.65
        await expect(borrowVault.connect(borrower).openPosition(
            borrower.address,
            colToken,
            debtToken,
            colAmount,
            borrowAmount,
            duration
        )).to.be.revertedWithCustomError(borrowVault, "InsufficientLTV");
    });

    it("should allow repayment and returning collateral", async function () {
        const colToken = await wBTC.getAddress();
        const debtToken = await wUSDC.getAddress();
        
        const colAmount = 1n * 10n**8n;
        const borrowAmount = 30000n * 10n**8n;
        const duration = 86400;

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

        // Give borrower USDC to repay
        await wUSDC.mint(borrower.address, borrowAmount + 1000n * 10n**8n); // extra for interest
        await wUSDC.connect(borrower).approve(await borrowVault.getAddress(), ethers.MaxUint256);

        // Repay full
        const preColBal = await wBTC.balanceOf(borrower.address);
        await borrowVault.connect(borrower).repay(posId, ethers.MaxUint256);
        const postColBal = await wBTC.balanceOf(borrower.address);
        
        // Returned 1 BTC
        expect(postColBal - preColBal).to.equal(colAmount);

        const pos = await borrowVault.getPosition(posId);
        expect(pos.active).to.be.false;
    });

    it("should route 10% of accrued interest to protocolTreasury on full repayment", async function () {
        const colToken = await wBTC.getAddress();
        const debtToken = await wUSDC.getAddress();
        const treasury = await borrowVault.protocolTreasury();
        expect(treasury).to.equal(owner.address);

        const colAmount = 1n * 10n**8n;
        const borrowAmount = 30000n * 10n**8n;
        const duration = 86400 * 5; // 5 days

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

        // Advance time 2 days so interest accrues
        await network.provider.send("evm_increaseTime", [86400 * 2]);
        await network.provider.send("evm_mine");

        await wUSDC.mint(borrower.address, borrowAmount + 1000n * 10n**8n);
        await wUSDC.connect(borrower).approve(await borrowVault.getAddress(), ethers.MaxUint256);

        const preTreasuryBal = await wUSDC.balanceOf(treasury);
        const preLendingPoolBal = await wUSDC.balanceOf(await lendingPool.getAddress());

        const repayTx = await borrowVault.connect(borrower).repay(posId, ethers.MaxUint256);
        const repayReceipt = await repayTx.wait();

        const feeEvent = repayReceipt.logs.find((l: any) => l.fragment?.name === "ProtocolFeeCollected");
        expect(feeEvent).to.not.be.undefined;
        const feeAmount = feeEvent.args.amount;
        expect(feeAmount).to.be.gt(0n);
        expect(feeEvent.args.treasury).to.equal(treasury);

        const postTreasuryBal = await wUSDC.balanceOf(treasury);
        const postLendingPoolBal = await wUSDC.balanceOf(await lendingPool.getAddress());

        // Verify treasury received feeAmount
        expect(postTreasuryBal - preTreasuryBal).to.equal(feeAmount);

        // Verify lendingPool received the rest
        const repayEvent = repayReceipt.logs.find((l: any) => l.fragment?.name === "Repaid");
        const totalRepaid = repayEvent.args.amount;
        expect(postLendingPoolBal - preLendingPoolBal).to.equal(totalRepaid - feeAmount);
    });

    it("should route 10% of partial repayment when amount <= accrued interest", async function () {
        const colToken = await wBTC.getAddress();
        const debtToken = await wUSDC.getAddress();
        const treasury = await borrowVault.protocolTreasury();

        const colAmount = 1n * 10n**8n;
        const borrowAmount = 30000n * 10n**8n;
        const duration = 86400 * 5;

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

        // Advance time 2 days
        await network.provider.send("evm_increaseTime", [86400 * 2]);
        await network.provider.send("evm_mine");

        const partialAmount = 1n * 10n**8n; // 1 USDC (accrued is ~3 USDC)
        await wUSDC.mint(borrower.address, partialAmount);
        await wUSDC.connect(borrower).approve(await borrowVault.getAddress(), ethers.MaxUint256);

        const preTreasuryBal = await wUSDC.balanceOf(treasury);
        const repayTx = await borrowVault.connect(borrower).repay(posId, partialAmount);
        const repayReceipt = await repayTx.wait();

        const feeEvent = repayReceipt.logs.find((l: any) => l.fragment?.name === "ProtocolFeeCollected");
        expect(feeEvent).to.not.be.undefined;
        const expectedFee = (partialAmount * 10n) / 100n; // 10%
        expect(feeEvent.args.amount).to.equal(expectedFee);

        const postTreasuryBal = await wUSDC.balanceOf(treasury);
        expect(postTreasuryBal - preTreasuryBal).to.equal(expectedFee);
    });

    it("should charge late grace fee and transfer to protocolTreasury when repaying in grace period", async function () {
        const colToken = await wBTC.getAddress();
        const debtToken = await wUSDC.getAddress();
        const treasury = await borrowVault.protocolTreasury();

        const colAmount = 1n * 10n**8n;
        const borrowAmount = 30000n * 10n**8n;
        const duration = 86400; // 1 day

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

        // Advance time into the 15-minute grace period: 1 day + 300s (5 minutes into grace period)
        await network.provider.send("evm_increaseTime", [86400 + 300]);
        await network.provider.send("evm_mine");

        // Mint and approve extra wUSDC for borrower to cover totalDebt + graceFee
        await wUSDC.mint(borrower.address, borrowAmount + 2000n * 10n**8n);
        await wUSDC.connect(borrower).approve(await borrowVault.getAddress(), ethers.MaxUint256);

        const preTreasuryBal = await wUSDC.balanceOf(treasury);
        const repayTx = await borrowVault.connect(borrower).repay(posId, ethers.MaxUint256);
        const repayReceipt = await repayTx.wait();

        // Verify ProtocolFeeCollected events
        const feeEvents = repayReceipt.logs
            .filter((l: any) => l.fragment?.name === "ProtocolFeeCollected")
            .map((l: any) => l.args);
        expect(feeEvents.length).to.be.gte(1);

        const graceFeeEvent = feeEvents[0];
        expect(graceFeeEvent.positionId).to.equal(posId);
        expect(graceFeeEvent.treasury).to.equal(treasury);

        const repayEvent = repayReceipt.logs.find((l: any) => l.fragment?.name === "Repaid");
        const totalDebt = repayEvent.args.amount;

        // graceFee = MathLib.wadMul(totalDebt, 0.015e18) = (totalDebt * 0.015e18 + (WAD / 2)) / WAD
        const WAD = 10n**18n;
        const expectedGraceFee = (totalDebt * ethers.parseUnits("0.015", 18) + (WAD / 2n)) / WAD;
        expect(graceFeeEvent.amount).to.equal(expectedGraceFee);
        expect(graceFeeEvent.amount).to.be.gt(0n);

        // Verify protocolTreasury received graceFee (plus any accrued interest protocol cut)
        const postTreasuryBal = await wUSDC.balanceOf(treasury);
        const totalFeesCollected = feeEvents.reduce((acc: bigint, e: any) => acc + e.amount, 0n);
        expect(postTreasuryBal - preTreasuryBal).to.equal(totalFeesCollected);
        expect(postTreasuryBal - preTreasuryBal).to.be.gte(expectedGraceFee);
    });

    describe("seizeCollateral", function () {
        let posId: string;
        const colAmount = 1n * 10n**8n; // 1 BTC
        const borrowAmount = 30000n * 10n**8n; // 30,000 USDC
        const duration = 86400; // 1 day

        beforeEach(async function () {
            const colToken = await wBTC.getAddress();
            const debtToken = await wUSDC.getAddress();

            const tx = await borrowVault.connect(borrower).openPosition(
                borrower.address,
                colToken,
                debtToken,
                colAmount,
                borrowAmount,
                duration
            );
            const receipt = await tx.wait();
            posId = receipt.logs.find((l: any) => l.fragment?.name === "PositionOpened").args.positionId;
        });

        it("should refund remaining collateral to borrower when refundToBorrower is true", async function () {
            const preBorrowerBal = await wBTC.balanceOf(borrower.address);
            const preLiquidatorBal = await wBTC.balanceOf(liquidator.address);

            // Seize 0.4 BTC total, closePosition = true, refundToBorrower = true
            const collateralToLiquidator = ethers.parseUnits("0.4", 8);
            const collateralToReserve = 0n;

            await borrowVault.connect(liquidator).seizeCollateral(
                posId,
                liquidator.address,
                collateralToLiquidator,
                collateralToReserve,
                true,
                true
            );

            // Liquidator receives 0.4 BTC
            const postLiquidatorBal = await wBTC.balanceOf(liquidator.address);
            expect(postLiquidatorBal - preLiquidatorBal).to.equal(collateralToLiquidator);

            // Borrower receives remaining 0.6 BTC refund
            const postBorrowerBal = await wBTC.balanceOf(borrower.address);
            expect(postBorrowerBal - preBorrowerBal).to.equal(ethers.parseUnits("0.6", 8));

            // Position status: collateralAmount becomes 0 and active becomes false
            const pos = await borrowVault.getPosition(posId);
            expect(pos.collateralAmount).to.equal(0n);
            expect(pos.active).to.be.false;
        });

        it("should retain surplus collateral in vault when refundToBorrower is false", async function () {
            const preBorrowerBal = await wBTC.balanceOf(borrower.address);
            const preVaultBal = await wBTC.balanceOf(await borrowVault.getAddress());

            // Seize 0.4 BTC total, closePosition = true, refundToBorrower = false
            const collateralToLiquidator = ethers.parseUnits("0.4", 8);
            const collateralToReserve = 0n;

            await borrowVault.connect(liquidator).seizeCollateral(
                posId,
                liquidator.address,
                collateralToLiquidator,
                collateralToReserve,
                true,
                false
            );

            // Borrower receives 0 BTC refund
            const postBorrowerBal = await wBTC.balanceOf(borrower.address);
            expect(postBorrowerBal - preBorrowerBal).to.equal(0n);

            // Vault collateral only decreased by 0.4 BTC (0.6 BTC surplus remains in vault)
            const postVaultBal = await wBTC.balanceOf(await borrowVault.getAddress());
            expect(preVaultBal - postVaultBal).to.equal(collateralToLiquidator);

            // Position status: collateralAmount remains 0.6 BTC and active becomes false
            const pos = await borrowVault.getPosition(posId);
            expect(pos.collateralAmount).to.equal(ethers.parseUnits("0.6", 8));
            expect(pos.active).to.be.false;
        });

        it("should distribute collateral between liquidator and protocolTreasury on dual distribution", async function () {
            const treasury = await borrowVault.protocolTreasury();
            const preLiquidatorBal = await wBTC.balanceOf(liquidator.address);
            const preTreasuryBal = await wBTC.balanceOf(treasury);

            // Seize collateral with collateralToLiquidator = 0.3 BTC, collateralToReserve = 0.1 BTC
            const collateralToLiquidator = ethers.parseUnits("0.3", 8);
            const collateralToReserve = ethers.parseUnits("0.1", 8);

            await borrowVault.connect(liquidator).seizeCollateral(
                posId,
                liquidator.address,
                collateralToLiquidator,
                collateralToReserve,
                true,
                true
            );

            // Liquidator receives 0.3 BTC
            const postLiquidatorBal = await wBTC.balanceOf(liquidator.address);
            expect(postLiquidatorBal - preLiquidatorBal).to.equal(collateralToLiquidator);

            // Treasury receives 0.1 BTC
            const postTreasuryBal = await wBTC.balanceOf(treasury);
            expect(postTreasuryBal - preTreasuryBal).to.equal(collateralToReserve);
        });
    });
});
