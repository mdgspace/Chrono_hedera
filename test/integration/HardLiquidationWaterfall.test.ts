import { expect } from "chai";
import { ethers, network } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("HardLiquidationWaterfall Integration", function () {
    let owner: HardhatEthersSigner;
    let borrower: HardhatEthersSigner;
    let spProvider: HardhatEthersSigner;
    let liquidator: HardhatEthersSigner;

    // Tokens
    let wUSDC: any;
    let wBTC: any;
    let usdcAddr: string;
    let btcAddr: string;

    // Core protocol contracts
    let assetRegistry: any;
    let oracle: any;
    let lendingPool: any;
    let interestEngine: any;
    let riskEngine: any;
    let stabilityPool: any;
    let schedulerEngine: any;
    let borrowVault: any;
    let liquidationEngine: any;
    let chronoRouter: any;

    const WAD = 10n ** 18n;

    function wadMul(a: bigint, b: bigint): bigint {
        return (a * b + WAD / 2n) / WAD;
    }

    function wadDiv(a: bigint, b: bigint): bigint {
        return (a * WAD + b / 2n) / b;
    }

    function findLog(contract: any, receipt: any, eventName: string) {
        for (const log of receipt.logs) {
            try {
                const parsed = contract.interface.parseLog(log);
                if (parsed && parsed.name === eventName) {
                    return parsed;
                }
            } catch {}
        }
        return null;
    }

    function filterLogs(contract: any, receipt: any, eventName: string) {
        const matches: any[] = [];
        for (const log of receipt.logs) {
            try {
                const parsed = contract.interface.parseLog(log);
                if (parsed && parsed.name === eventName) {
                    matches.push(parsed);
                }
            } catch {}
        }
        return matches;
    }

    beforeEach(async function () {
        [owner, borrower, spProvider, liquidator] = await ethers.getSigners();

        // 1. Deploy Tokens (8 decimals)
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        wUSDC = await MockERC20.deploy("Wrapped USDC", "wUSDC", 8);
        await wUSDC.waitForDeployment();
        usdcAddr = await wUSDC.getAddress();

        wBTC = await MockERC20.deploy("Wrapped BTC", "wBTC", 8);
        await wBTC.waitForDeployment();
        btcAddr = await wBTC.getAddress();

        // 2. Deploy AssetRegistry and register assets with calibrated hard liquidation parameters
        const AssetRegistry = await ethers.getContractFactory("AssetRegistry");
        assetRegistry = await AssetRegistry.deploy(owner.address);
        await assetRegistry.waitForDeployment();

        // Calibrated parameters:
        // hardLiqPenalty: 12% (0.12e18)
        // hardLiqCollateralFloor: 2.5% (0.025e18)
        // stabilityPoolPenaltyShare: 75% (0.75e18)
        // reservePenaltyShare: 25% (0.25e18)
        await assetRegistry.registerAsset({
            tokenAddress: usdcAddr,
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
            hardLiqPenalty: ethers.parseUnits("0.12", 18),
            hardLiqCollateralFloor: ethers.parseUnits("0.025", 18),
            stabilityPoolPenaltyShare: ethers.parseUnits("0.75", 18),
            reservePenaltyShare: ethers.parseUnits("0.25", 18),
            minBorrowDuration: 3600,
            maxBorrowDuration: 2592000,
            isActive: true
        });

        await assetRegistry.registerAsset({
            tokenAddress: btcAddr,
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
            hardLiqPenalty: ethers.parseUnits("0.12", 18),
            hardLiqCollateralFloor: ethers.parseUnits("0.025", 18),
            stabilityPoolPenaltyShare: ethers.parseUnits("0.75", 18),
            reservePenaltyShare: ethers.parseUnits("0.25", 18),
            minBorrowDuration: 3600,
            maxBorrowDuration: 2592000,
            isActive: true
        });

        // 3. Deploy MockOracleAdapter and set prices (BTC = $60,000, USDC = $1)
        const MockOracle = await ethers.getContractFactory("MockOracleAdapter");
        oracle = await MockOracle.deploy();
        await oracle.waitForDeployment();
        await oracle.setPrice(btcAddr, ethers.parseUnits("60000", 18), 8);
        await oracle.setPrice(usdcAddr, ethers.parseUnits("1", 18), 8);

        // 4. Deploy Protocol Contracts
        const LendingPool = await ethers.getContractFactory("LendingPool");
        lendingPool = await LendingPool.deploy(await assetRegistry.getAddress(), owner.address);
        await lendingPool.waitForDeployment();

        const InterestEngine = await ethers.getContractFactory("InterestEngine");
        interestEngine = await InterestEngine.deploy(await lendingPool.getAddress(), await assetRegistry.getAddress(), owner.address);
        await interestEngine.waitForDeployment();

        const RiskEngine = await ethers.getContractFactory("RiskEngine");
        riskEngine = await RiskEngine.deploy(await assetRegistry.getAddress());
        await riskEngine.waitForDeployment();

        const StabilityPool = await ethers.getContractFactory("StabilityPool");
        stabilityPool = await StabilityPool.deploy();
        await stabilityPool.waitForDeployment();

        const MockScheduler = await ethers.getContractFactory("MockSchedulerEngine");
        schedulerEngine = await MockScheduler.deploy();
        await schedulerEngine.waitForDeployment();

        const LiquidationEngine = await ethers.getContractFactory("LiquidationEngine");
        liquidationEngine = await LiquidationEngine.deploy();
        await liquidationEngine.waitForDeployment();

        const BorrowVault = await ethers.getContractFactory("BorrowVault");
        borrowVault = await BorrowVault.deploy();
        await borrowVault.waitForDeployment();

        const ChronoRouter = await ethers.getContractFactory("ChronoRouter");
        chronoRouter = await ChronoRouter.deploy();
        await chronoRouter.waitForDeployment();

        // 5. Wire Initializations
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

        await chronoRouter.initialize(
            await oracle.getAddress(),
            await borrowVault.getAddress(),
            await lendingPool.getAddress()
        );

        // 6. Wire Authorizations
        await lendingPool.setAuthorized(await chronoRouter.getAddress(), true);
        await lendingPool.setAuthorized(await borrowVault.getAddress(), true);
        await lendingPool.setAuthorized(await liquidationEngine.getAddress(), true);

        await interestEngine.setAuthorized(await borrowVault.getAddress(), true);
        await interestEngine.setAuthorized(await liquidationEngine.getAddress(), true);

        // 7. Seed LendingPool with initial USDC liquidity
        const initialLendingDeposit = 1000000n * 10n**8n; // 1,000,000 USDC
        await wUSDC.mint(owner.address, initialLendingDeposit);
        await wUSDC.approve(await lendingPool.getAddress(), ethers.MaxUint256);
        await lendingPool.deposit(usdcAddr, initialLendingDeposit, owner.address);
    });

    describe("a. Lender Invariant & Solvent Waterfall", function () {
        it("should execute solvent waterfall via StabilityPool, distribute dual-tranche penalty, refund surplus to borrower, and restore LendingPool liquidity", async function () {
            const colAmount = 1n * 10n**8n; // 1 BTC ($60,000)
            const borrowAmount = 30000n * 10n**8n; // 30,000 USDC
            const duration = 86400; // 1 day

            // 1. Borrower deposits 1 BTC and borrows 30,000 USDC via ChronoRouter
            await wBTC.mint(borrower.address, colAmount);
            await wBTC.connect(borrower).approve(await chronoRouter.getAddress(), colAmount);

            const openTx = await chronoRouter.connect(borrower).openPosition(
                btcAddr,
                usdcAddr,
                colAmount,
                borrowAmount,
                duration
            );
            const openReceipt = await openTx.wait();
            const openLog = findLog(borrowVault, openReceipt, "PositionOpened");
            expect(openLog).to.not.be.null;
            const posId = openLog.args.positionId;

            // Verify borrower received borrowed USDC and LendingPool recorded totalBorrowed
            expect(await wUSDC.balanceOf(borrower.address)).to.equal(borrowAmount);
            expect(await lendingPool.getTotalBorrowed(usdcAddr)).to.equal(borrowAmount);

            // 2. Stability pool depositors deposit 50,000 USDC into StabilityPool
            const spDeposit = 50000n * 10n**8n; // 50,000 USDC
            await wUSDC.mint(spProvider.address, spDeposit);
            await wUSDC.connect(spProvider).approve(await stabilityPool.getAddress(), spDeposit);
            await stabilityPool.connect(spProvider).deposit(usdcAddr, spDeposit);

            // Verify StabilityPool can absorb total debt
            expect(await stabilityPool.canAbsorb(usdcAddr, borrowAmount)).to.be.true;

            // 3. Fast forward past expiry + 900s grace window
            await network.provider.send("evm_increaseTime", [duration + 901]);
            await network.provider.send("evm_mine");

            // Snapshot balances prior to hard liquidation
            const treasury = await borrowVault.protocolTreasury();
            const preLendingPoolBal = await wUSDC.balanceOf(await lendingPool.getAddress());
            const preSpBal = await wBTC.balanceOf(await stabilityPool.getAddress());
            const preTreasuryBal = await wBTC.balanceOf(treasury);
            const preBorrowerBal = await wBTC.balanceOf(borrower.address);
            const preTotalBorrowed = await lendingPool.getTotalBorrowed(usdcAddr);

            expect(preTotalBorrowed).to.equal(borrowAmount);

            // 4. Execute hard liquidation
            const liqTx = await liquidationEngine.executeHardLiquidation(posId);
            const liqReceipt = await liqTx.wait();

            const hardLiqLog = findLog(liquidationEngine, liqReceipt, "HardLiquidation");
            expect(hardLiqLog).to.not.be.null;
            const totalDebt = hardLiqLog.args.debtRepaid;
            const requiredCollateral = hardLiqLog.args.collateralSeized;

            // 5. Calculate expected waterfall values mathematically
            const collPrice = await oracle.getPrice(btcAddr);
            const debtPrice = await oracle.getPrice(usdcAddr);
            const totalDebtValue = wadMul(totalDebt, debtPrice);
            const totalCollValue = wadMul(colAmount, collPrice);

            const hardLiqPenalty = ethers.parseUnits("0.12", 18);
            const hardLiqCollateralFloor = ethers.parseUnits("0.025", 18);
            const spPenaltyShare = ethers.parseUnits("0.75", 18);

            const penDebtVal = wadMul(totalDebtValue, hardLiqPenalty);
            const penFloorVal = wadMul(totalCollValue, hardLiqCollateralFloor);
            const penaltyValue = penDebtVal > penFloorVal ? penDebtVal : penFloorVal;

            const debtCollateral = wadDiv(totalDebtValue, collPrice);
            const penaltyCollateral = wadDiv(penaltyValue, collPrice);

            const expectedRequiredCollateral = debtCollateral + penaltyCollateral;
            const spPenaltyCollateral = wadMul(penaltyCollateral, spPenaltyShare);
            const reservePenaltyCollateral = penaltyCollateral - spPenaltyCollateral;
            const spTotalCollateral = debtCollateral + spPenaltyCollateral;
            const surplusRefund = colAmount - expectedRequiredCollateral;

            expect(requiredCollateral).to.equal(expectedRequiredCollateral);

            // Assertions:
            // a. lendingPool.totalBorrowed drops to 0
            const postTotalBorrowed = await lendingPool.getTotalBorrowed(usdcAddr);
            expect(postTotalBorrowed).to.equal(0n);

            // b. LendingPool receives total debt in USDC
            const postLendingPoolBal = await wUSDC.balanceOf(await lendingPool.getAddress());
            expect(postLendingPoolBal - preLendingPoolBal).to.equal(totalDebt);

            // c. StabilityPool receives C_debt + 0.75 * C_penalty of BTC
            const postSpBal = await wBTC.balanceOf(await stabilityPool.getAddress());
            expect(postSpBal - preSpBal).to.equal(spTotalCollateral);

            // d. Protocol treasury receives 0.25 * C_penalty of BTC
            const postTreasuryBal = await wBTC.balanceOf(treasury);
            expect(postTreasuryBal - preTreasuryBal).to.equal(reservePenaltyCollateral);

            // e. Borrower receives residual surplus BTC
            const postBorrowerBal = await wBTC.balanceOf(borrower.address);
            expect(postBorrowerBal - preBorrowerBal).to.equal(surplusRefund);

            // Invariant: Collateral conservation (no leaked satoshis)
            expect(spTotalCollateral + reservePenaltyCollateral + surplusRefund).to.equal(colAmount);

            // f. Position is inactive and zeroed in vault
            const pos = await borrowVault.getPosition(posId);
            expect(pos.active).to.be.false;
            expect(pos.collateralAmount).to.equal(0n);
        });
    });

    describe("b. Solvency-Gated Lock (Insolvent Fallback)", function () {
        it("should retain surplus strictly locked in vault, give zero refund to borrower, send requiredCollateral to owner reserve, and clear totalBorrowed", async function () {
            const colAmount = 1n * 10n**8n; // 1 BTC
            const borrowAmount = 30000n * 10n**8n; // 30,000 USDC
            const duration = 86400; // 1 day

            // 1. Borrower deposits 1 BTC and borrows 30,000 USDC via ChronoRouter
            await wBTC.mint(borrower.address, colAmount);
            await wBTC.connect(borrower).approve(await chronoRouter.getAddress(), colAmount);

            const openTx = await chronoRouter.connect(borrower).openPosition(
                btcAddr,
                usdcAddr,
                colAmount,
                borrowAmount,
                duration
            );
            const openReceipt = await openTx.wait();
            const openLog = findLog(borrowVault, openReceipt, "PositionOpened");
            expect(openLog).to.not.be.null;
            const posId = openLog.args.positionId;

            // 2. Stability pool has 0 deposits (canAbsorb == false)
            expect(await stabilityPool.canAbsorb(usdcAddr, borrowAmount)).to.be.false;

            // 3. Fast forward past expiry + 900s grace window
            await network.provider.send("evm_increaseTime", [duration + 901]);
            await network.provider.send("evm_mine");

            // Snapshot balances prior to hard liquidation
            const preBorrowerBal = await wBTC.balanceOf(borrower.address);
            const preOwnerBal = await wBTC.balanceOf(owner.address);
            const preVaultBal = await wBTC.balanceOf(await borrowVault.getAddress());

            // 4. Execute hard liquidation
            const liqTx = await liquidationEngine.executeHardLiquidation(posId);
            const liqReceipt = await liqTx.wait();

            const hardLiqLog = findLog(liquidationEngine, liqReceipt, "HardLiquidation");
            expect(hardLiqLog).to.not.be.null;
            const requiredCollateral = hardLiqLog.args.collateralSeized;

            // Assertions:
            // a. Borrower receives 0 BTC refund (collateral remains strictly locked in vault)
            const postBorrowerBal = await wBTC.balanceOf(borrower.address);
            expect(postBorrowerBal).to.equal(preBorrowerBal);

            // Surplus collateral is strictly retained in BorrowVault
            const expectedSurplus = colAmount - requiredCollateral;
            expect(expectedSurplus).to.be.gt(0n);

            const pos = await borrowVault.getPosition(posId);
            expect(pos.collateralAmount).to.equal(expectedSurplus);
            expect(pos.active).to.be.false;

            const postVaultBal = await wBTC.balanceOf(await borrowVault.getAddress());
            expect(postVaultBal).to.equal(expectedSurplus);
            expect(preVaultBal - postVaultBal).to.equal(requiredCollateral);

            // b. owner() (recovery reserve) receives requiredCollateral
            const postOwnerBal = await wBTC.balanceOf(owner.address);
            expect(postOwnerBal - preOwnerBal).to.equal(requiredCollateral);

            // c. lendingPool.totalBorrowed drops to 0
            expect(await lendingPool.getTotalBorrowed(usdcAddr)).to.equal(0n);
        });
    });

    describe("c. Low-LTV Floor Protection", function () {
        it("should size penalty at 2.5% of collateral floor when floor exceeds 12% debt penalty, preventing zero-cost abandonment", async function () {
            const colAmount = 1n * 10n**8n; // 1 BTC ($60,000)
            const borrowAmount = 100n * 10n**8n; // 100 USDC ($100) -> extremely low LTV (~0.167%)
            const duration = 3600; // 1 hour

            // Stability pool has sufficient deposits to absorb 100 USDC
            const spDeposit = 1000n * 10n**8n;
            await wUSDC.mint(spProvider.address, spDeposit);
            await wUSDC.connect(spProvider).approve(await stabilityPool.getAddress(), spDeposit);
            await stabilityPool.connect(spProvider).deposit(usdcAddr, spDeposit);

            // Open position via ChronoRouter
            await wBTC.mint(borrower.address, colAmount);
            await wBTC.connect(borrower).approve(await chronoRouter.getAddress(), colAmount);

            const openTx = await chronoRouter.connect(borrower).openPosition(
                btcAddr,
                usdcAddr,
                colAmount,
                borrowAmount,
                duration
            );
            const openReceipt = await openTx.wait();
            const openLog = findLog(borrowVault, openReceipt, "PositionOpened");
            expect(openLog).to.not.be.null;
            const posId = openLog.args.positionId;

            // Fast forward past expiry + 900s grace window
            await network.provider.send("evm_increaseTime", [duration + 901]);
            await network.provider.send("evm_mine");

            const treasury = await borrowVault.protocolTreasury();
            const preTreasuryBal = await wBTC.balanceOf(treasury);
            const preSpBal = await wBTC.balanceOf(await stabilityPool.getAddress());

            // Execute hard liquidation
            const liqTx = await liquidationEngine.executeHardLiquidation(posId);
            const liqReceipt = await liqTx.wait();

            const hardLiqLog = findLog(liquidationEngine, liqReceipt, "HardLiquidation");
            expect(hardLiqLog).to.not.be.null;
            const totalDebt = hardLiqLog.args.debtRepaid;
            const requiredCollateral = hardLiqLog.args.collateralSeized;

            const collPrice = await oracle.getPrice(btcAddr);
            const debtPrice = await oracle.getPrice(usdcAddr);
            const totalDebtValue = wadMul(totalDebt, debtPrice);
            const totalCollValue = wadMul(colAmount, collPrice);

            const penDebtVal = wadMul(totalDebtValue, ethers.parseUnits("0.12", 18)); // ~ $12
            const penFloorVal = wadMul(totalCollValue, ethers.parseUnits("0.025", 18)); // $1,500 (2.5% of $60,000)

            // Assert floor penalty dominates 12% debt penalty
            expect(penFloorVal).to.be.gt(penDebtVal);

            const floorPenaltyCollateral = wadDiv(penFloorVal, collPrice);
            const debtPenaltyCollateral = wadDiv(penDebtVal, collPrice);
            const debtCollateral = wadDiv(totalDebtValue, collPrice);

            // Floor penalty is exactly 2.5% of 1 BTC = 0.025 BTC (2,500,000 satoshis)
            expect(floorPenaltyCollateral).to.equal(ethers.parseUnits("0.025", 8));
            expect(floorPenaltyCollateral).to.be.gt(debtPenaltyCollateral);
            expect(requiredCollateral).to.equal(debtCollateral + floorPenaltyCollateral);

            // StabilityPool receives debt collateral + 75% of 0.025 BTC floor penalty
            const expectedSpPenalty = wadMul(floorPenaltyCollateral, ethers.parseUnits("0.75", 18));
            const postSpBal = await wBTC.balanceOf(await stabilityPool.getAddress());
            expect(postSpBal - preSpBal).to.equal(debtCollateral + expectedSpPenalty);

            // Treasury receives 25% of 0.025 BTC floor penalty = 0.00625 BTC
            const expectedReservePenalty = floorPenaltyCollateral - expectedSpPenalty;
            expect(expectedReservePenalty).to.equal(ethers.parseUnits("0.00625", 8));
            const postTreasuryBal = await wBTC.balanceOf(treasury);
            expect(postTreasuryBal - preTreasuryBal).to.equal(expectedReservePenalty);
        });
    });

    describe("d. 15-Minute Grace Window & Late Grace Fee", function () {
        it("should revert hard liquidation during 15-minute grace window, and collect 1.5% late grace fee upon repayment", async function () {
            const colAmount = 1n * 10n**8n; // 1 BTC
            const borrowAmount = 30000n * 10n**8n; // 30,000 USDC
            const duration = 3600; // 1 hour

            // Open position via ChronoRouter
            await wBTC.mint(borrower.address, colAmount);
            await wBTC.connect(borrower).approve(await chronoRouter.getAddress(), colAmount);

            const openTx = await chronoRouter.connect(borrower).openPosition(
                btcAddr,
                usdcAddr,
                colAmount,
                borrowAmount,
                duration
            );
            const openReceipt = await openTx.wait();
            const openLog = findLog(borrowVault, openReceipt, "PositionOpened");
            expect(openLog).to.not.be.null;
            const posId = openLog.args.positionId;

            // 1. Fast forward to expiry + 300s (inside 15-min grace window: duration + 300s < duration + 900s)
            await network.provider.send("evm_increaseTime", [duration + 300]);
            await network.provider.send("evm_mine");

            // 2. Attempt hard liquidation -> reverts with "In grace period or not expired"
            await expect(
                liquidationEngine.executeHardLiquidation(posId)
            ).to.be.revertedWith("In grace period or not expired");

            // 3. Borrower repays in grace window -> 1.5% late fee charged to borrower and transferred to treasury
            const treasury = await borrowVault.protocolTreasury();
            const preTreasuryUSDC = await wUSDC.balanceOf(treasury);
            const preBorrowerBTC = await wBTC.balanceOf(borrower.address);

            // Fund borrower with extra USDC for principal + accrued interest + 1.5% grace fee
            await wUSDC.mint(borrower.address, 5000n * 10n**8n);
            await wUSDC.connect(borrower).approve(await borrowVault.getAddress(), ethers.MaxUint256);

            const repayTx = await borrowVault.connect(borrower).repay(posId, ethers.MaxUint256);
            const repayReceipt = await repayTx.wait();

            // Extract ProtocolFeeCollected events
            const feeEvents = filterLogs(borrowVault, repayReceipt, "ProtocolFeeCollected");
            expect(feeEvents.length).to.be.gte(1);

            // First fee event is the late grace fee: 1.5% of total debt
            const graceFeeEvent = feeEvents[0];
            expect(graceFeeEvent.args.positionId).to.equal(posId);
            expect(graceFeeEvent.args.treasury).to.equal(treasury);

            // Verify grace fee magnitude is approx 1.5% of 30,000 USDC (~450 USDC)
            const expectedGraceFeeMin = (borrowAmount * 15n) / 1000n; // 450 USDC minimum
            expect(graceFeeEvent.args.amount).to.be.gte(expectedGraceFeeMin);

            // Verify treasury received at least the grace fee
            const postTreasuryUSDC = await wUSDC.balanceOf(treasury);
            expect(postTreasuryUSDC - preTreasuryUSDC).to.be.gte(graceFeeEvent.args.amount);

            // Verify borrower receives full 1 BTC collateral back
            const postBorrowerBTC = await wBTC.balanceOf(borrower.address);
            expect(postBorrowerBTC - preBorrowerBTC).to.equal(colAmount);

            // Verify position closed and debt cleared
            const pos = await borrowVault.getPosition(posId);
            expect(pos.active).to.be.false;
            expect(pos.collateralAmount).to.equal(0n);
            expect(pos.borrowAmount).to.equal(0n);
            expect(await lendingPool.getTotalBorrowed(usdcAddr)).to.equal(0n);
        });
    });
});
