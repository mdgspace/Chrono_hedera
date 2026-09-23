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
    let spProvider: HardhatEthersSigner;

    let wUSDC: any;
    let wBTC: any;

    const WAD = 10n ** 18n;
    function wadMul(a: bigint, b: bigint): bigint {
        return (a * b + WAD / 2n) / WAD;
    }
    function wadDiv(a: bigint, b: bigint): bigint {
        return (a * WAD + b / 2n) / b;
    }

    beforeEach(async function () {
        [owner, borrower, liquidator, spProvider] = await ethers.getSigners();

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
            hardLiqPenalty: ethers.parseUnits("0.12", 18),
            hardLiqCollateralFloor: ethers.parseUnits("0.025", 18),
            stabilityPoolPenaltyShare: ethers.parseUnits("0.75", 18),
            reservePenaltyShare: ethers.parseUnits("0.25", 18),
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
            hardLiqPenalty: ethers.parseUnits("0.12", 18),
            hardLiqCollateralFloor: ethers.parseUnits("0.025", 18),
            stabilityPoolPenaltyShare: ethers.parseUnits("0.75", 18),
            reservePenaltyShare: ethers.parseUnits("0.25", 18),
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

    describe("grace period enforcement", function () {
        it("should revert during grace period and succeed after duration + 900", async function () {
            const colToken = await wBTC.getAddress();
            const debtToken = await wUSDC.getAddress();
            const colAmount = 1n * 10n**8n;
            const borrowAmount = 40000n * 10n**8n;
            const duration = 3600;

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

            // Fast forward into grace period (duration <= t < duration + 900)
            await network.provider.send("evm_increaseTime", [duration + 10]);
            await network.provider.send("evm_mine");

            await expect(
                liquidationEngine.executeHardLiquidation(posId)
            ).to.be.revertedWith("In grace period or not expired");

            // Fast forward past the 15-minute grace period
            await network.provider.send("evm_increaseTime", [900]);
            await network.provider.send("evm_mine");

            await expect(
                liquidationEngine.executeHardLiquidation(posId)
            ).to.emit(liquidationEngine, "HardLiquidation");
        });
    });

    describe("solvent hard liquidation (stabilityPool.canAbsorb == true)", function () {
        it("should settle via stability pool, distribute dual-tranche penalty, refund surplus, and decrement borrowed liquidity", async function () {
            const colToken = await wBTC.getAddress();
            const debtToken = await wUSDC.getAddress();
            const colAmount = 1n * 10n**8n; // 1 BTC
            const borrowAmount = 40000n * 10n**8n; // 40k USDC
            const duration = 3600;

            // Provide deposits into StabilityPool: mint wUSDC to provider, approve and deposit
            const spDeposit = 100000n * 10n**8n; // 100k USDC
            await wUSDC.mint(spProvider.address, spDeposit);
            await wUSDC.connect(spProvider).approve(await stabilityPool.getAddress(), ethers.MaxUint256);
            await stabilityPool.connect(spProvider).deposit(debtToken, spDeposit);

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

            // Fast forward past expiry + grace period
            await network.provider.send("evm_increaseTime", [duration + 901]);
            await network.provider.send("evm_mine");

            const treasury = await borrowVault.protocolTreasury();
            const preTreasuryBal = await wBTC.balanceOf(treasury);
            const preSpBal = await wBTC.balanceOf(await stabilityPool.getAddress());
            const preBorrowerBal = await wBTC.balanceOf(borrower.address);
            const preTotalBorrowed = await lendingPool.getTotalBorrowed(debtToken);

            const liqTx = await liquidationEngine.executeHardLiquidation(posId);
            const liqReceipt = await liqTx.wait();
            const hardLiqLog = liqReceipt.logs.find((l: any) => l.fragment?.name === "HardLiquidation");
            const totalDebt = hardLiqLog.args.debtRepaid;
            const requiredCollateral = hardLiqLog.args.collateralSeized;

            // Calculate expected waterfall values
            const collPrice = await oracle.getPrice(colToken);
            const debtPrice = await oracle.getPrice(debtToken);
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

            // 1. Verify stability pool receives spTotalCollateral = debtCollateral + 75% of penaltyCollateral
            const postSpBal = await wBTC.balanceOf(await stabilityPool.getAddress());
            expect(postSpBal - preSpBal).to.equal(spTotalCollateral);

            // 2. Verify protocol treasury receives reservePenaltyCollateral = 25% of penaltyCollateral
            const postTreasuryBal = await wBTC.balanceOf(treasury);
            expect(postTreasuryBal - preTreasuryBal).to.equal(reservePenaltyCollateral);

            // 3. Verify borrower receives surplus collateral refund (collateralAmount - requiredCollateral)
            const postBorrowerBal = await wBTC.balanceOf(borrower.address);
            expect(postBorrowerBal - preBorrowerBal).to.equal(surplusRefund);

            // 4. Verify lendingPool borrowed liquidity was returned/decremented
            const postTotalBorrowed = await lendingPool.getTotalBorrowed(debtToken);
            expect(preTotalBorrowed - postTotalBorrowed).to.equal(borrowAmount);
            expect(postTotalBorrowed).to.equal(0n);

            // Verify position closed and collateral zeroed in vault
            const pos = await borrowVault.getPosition(posId);
            expect(pos.active).to.be.false;
            expect(pos.collateralAmount).to.equal(0n);
        });
    });

    describe("insolvent fallback (stabilityPool.canAbsorb == false)", function () {
        it("should seize requiredCollateral to owner, lock surplus in vault, and give zero refund to borrower", async function () {
            const colToken = await wBTC.getAddress();
            const debtToken = await wUSDC.getAddress();
            const colAmount = 1n * 10n**8n; // 1 BTC
            const borrowAmount = 40000n * 10n**8n; // 40k USDC
            const duration = 3600;

            // Zero stability pool deposits - ensure stabilityPool.canAbsorb == false
            expect(await stabilityPool.canAbsorb(debtToken, borrowAmount)).to.be.false;

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

            // Fast forward past expiry + grace period
            await network.provider.send("evm_increaseTime", [duration + 901]);
            await network.provider.send("evm_mine");

            const preBorrowerBal = await wBTC.balanceOf(borrower.address);
            const preOwnerBal = await wBTC.balanceOf(owner.address);
            const preVaultBal = await wBTC.balanceOf(await borrowVault.getAddress());

            const liqTx = await liquidationEngine.executeHardLiquidation(posId);
            const liqReceipt = await liqTx.wait();
            const hardLiqLog = liqReceipt.logs.find((l: any) => l.fragment?.name === "HardLiquidation");
            const requiredCollateral = hardLiqLog.args.collateralSeized;

            // 1. Verify borrower receives NO refund (balance unchanged)
            const postBorrowerBal = await wBTC.balanceOf(borrower.address);
            expect(postBorrowerBal).to.equal(preBorrowerBal);

            // 2. Verify surplus remains locked in vault
            const expectedSurplus = colAmount - requiredCollateral;
            expect(expectedSurplus).to.be.gt(0n);

            const pos = await borrowVault.getPosition(posId);
            expect(pos.collateralAmount).to.equal(expectedSurplus);
            expect(pos.active).to.be.false;

            const postVaultBal = await wBTC.balanceOf(await borrowVault.getAddress());
            expect(postVaultBal).to.equal(expectedSurplus);
            expect(preVaultBal - postVaultBal).to.equal(requiredCollateral);

            // 3. Verify owner.address (owner()) receives requiredCollateral
            const postOwnerBal = await wBTC.balanceOf(owner.address);
            expect(postOwnerBal - preOwnerBal).to.equal(requiredCollateral);

            // 4. Verify lendingPool borrowed liquidity was decremented
            expect(await lendingPool.getTotalBorrowed(debtToken)).to.equal(0n);
        });
    });

    describe("low-LTV floor penalty", function () {
        it("should apply 2.5% collateral floor when floor penalty exceeds 12% debt penalty", async function () {
            const colToken = await wBTC.getAddress();
            const debtToken = await wUSDC.getAddress();
            const colAmount = 1n * 10n**8n; // 1 BTC ($60,000)
            const borrowAmount = 100n * 10n**8n; // 100 USDC ($100) -> very low LTV
            const duration = 3600;

            // Provide deposits into StabilityPool to absorb 100 USDC
            const spDeposit = 1000n * 10n**8n;
            await wUSDC.mint(spProvider.address, spDeposit);
            await wUSDC.connect(spProvider).approve(await stabilityPool.getAddress(), ethers.MaxUint256);
            await stabilityPool.connect(spProvider).deposit(debtToken, spDeposit);

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

            // Fast forward past expiry + grace period
            await network.provider.send("evm_increaseTime", [duration + 901]);
            await network.provider.send("evm_mine");

            const treasury = await borrowVault.protocolTreasury();
            const preTreasuryBal = await wBTC.balanceOf(treasury);
            const preSpBal = await wBTC.balanceOf(await stabilityPool.getAddress());

            const liqTx = await liquidationEngine.executeHardLiquidation(posId);
            const liqReceipt = await liqTx.wait();
            const hardLiqLog = liqReceipt.logs.find((l: any) => l.fragment?.name === "HardLiquidation");
            const totalDebt = hardLiqLog.args.debtRepaid;
            const requiredCollateral = hardLiqLog.args.collateralSeized;

            const collPrice = await oracle.getPrice(colToken);
            const debtPrice = await oracle.getPrice(debtToken);
            const totalDebtValue = wadMul(totalDebt, debtPrice);
            const totalCollValue = wadMul(colAmount, collPrice);

            const penDebtVal = wadMul(totalDebtValue, ethers.parseUnits("0.12", 18));
            const penFloorVal = wadMul(totalCollValue, ethers.parseUnits("0.025", 18));

            // Verify 2.5% of collateral value > 12% of debt value
            expect(penFloorVal).to.be.gt(penDebtVal);

            const floorPenaltyCollateral = wadDiv(penFloorVal, collPrice);
            const debtPenaltyCollateral = wadDiv(penDebtVal, collPrice);
            const debtCollateral = wadDiv(totalDebtValue, collPrice);

            // Floor penalty is exactly 2.5% of 1 BTC = 0.025 BTC (2,500,000 units)
            expect(floorPenaltyCollateral).to.equal(ethers.parseUnits("0.025", 8));
            expect(floorPenaltyCollateral).to.be.gt(debtPenaltyCollateral);
            expect(requiredCollateral).to.equal(debtCollateral + floorPenaltyCollateral);

            // Verify penalty collaterals use the 2.5% floor
            const expectedSpPenalty = wadMul(floorPenaltyCollateral, ethers.parseUnits("0.75", 18));
            const expectedReservePenalty = floorPenaltyCollateral - expectedSpPenalty;

            const postSpBal = await wBTC.balanceOf(await stabilityPool.getAddress());
            expect(postSpBal - preSpBal).to.equal(debtCollateral + expectedSpPenalty);

            const postTreasuryBal = await wBTC.balanceOf(treasury);
            expect(postTreasuryBal - preTreasuryBal).to.equal(expectedReservePenalty);
            expect(expectedReservePenalty).to.equal(ethers.parseUnits("0.00625", 8)); // 25% of 0.025 BTC
        });
    });
});
