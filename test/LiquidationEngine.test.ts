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

    it("should lock dependency wiring after initialization", async function () {
        await expect(liquidationEngine.initialize(owner.address, owner.address, owner.address,
            owner.address, owner.address, owner.address, owner.address))
          .to.be.revertedWith("LiquidationEngine already initialized");
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

            // Empty stability pool: the expired position goes to auction
            await expect(
                liquidationEngine.executeHardLiquidation(posId)
            ).to.emit(liquidationEngine, "AuctionStarted");
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

    async function openFor(who: HardhatEthersSigner, colAmount: bigint, borrowAmount: bigint, duration: number) {
        await wBTC.mint(who.address, colAmount);
        await wBTC.connect(who).approve(await borrowVault.getAddress(), ethers.MaxUint256);
        const tx = await borrowVault.connect(who).openPosition(
            who.address, await wBTC.getAddress(), await wUSDC.getAddress(), colAmount, borrowAmount, duration
        );
        const receipt = await tx.wait();
        return receipt.logs.find((l: any) => l.fragment?.name === "PositionOpened").args.positionId;
    }

    async function fundStabilityPool(amount: bigint) {
        await wUSDC.mint(spProvider.address, amount);
        await wUSDC.connect(spProvider).approve(await stabilityPool.getAddress(), ethers.MaxUint256);
        await stabilityPool.connect(spProvider).deposit(await wUSDC.getAddress(), amount);
    }

    async function skip(seconds: number) {
        await network.provider.send("evm_increaseTime", [seconds]);
        await network.provider.send("evm_mine");
    }

    const PHASE1 = 900n;
    const AUCTION_END = 2700n;

    // Mirrors LiquidationEngine._auctionPrice
    function priceAt(a: any, elapsed: bigint): bigint {
        if (elapsed < PHASE1) return a.startPrice - ((a.startPrice - a.floorPrice) * elapsed) / PHASE1;
        return a.floorPrice - (a.floorPrice * (elapsed - PHASE1)) / (AUCTION_END - PHASE1);
    }

    describe("hard-liquidation Dutch auction (stabilityPool.canAbsorb == false)", function () {
        const colAmount = 1n * 10n**8n; // 1 BTC ($60k)
        const borrowAmount = 40000n * 10n**8n; // 40k USDC
        const duration = 3600;
        let posId: string;

        beforeEach(async function () {
            posId = await openFor(borrower, colAmount, borrowAmount, duration);
            await skip(duration + 901);
        });

        it("starts an auction instead of seizing to owner: engine holds all collateral and totalBorrowed is unchanged", async function () {
            const debtToken = await wUSDC.getAddress();
            const engineAddr = await liquidationEngine.getAddress();
            expect(await stabilityPool.canAbsorb(debtToken, borrowAmount)).to.be.false;

            const preOwnerBal = await wBTC.balanceOf(owner.address);
            const preBorrowerBal = await wBTC.balanceOf(borrower.address);
            const preTotalBorrowed = await lendingPool.getTotalBorrowed(debtToken);

            const liqTx = await liquidationEngine.executeHardLiquidation(posId);
            await expect(liqTx).to.not.emit(liquidationEngine, "HardLiquidation");

            const a = await liquidationEngine.auctions(posId);
            const block = await ethers.provider.getBlock(liqTx.blockNumber);
            expect(a.startedAt).to.equal(BigInt(block!.timestamp));
            expect(a.collateral).to.equal(colAmount);
            expect(a.principal).to.equal(borrowAmount);
            expect(a.debt).to.be.gt(borrowAmount); // principal + accrued interest

            // Oracle snapshot: BTC/USDC = 60000; penalty = max(12% debt, 2.5% collateral) in USDC
            const expectedPenalty = wadDiv(wadMul(wadMul(a.debt, WAD), ethers.parseUnits("0.12", 18)), WAD);
            expect(a.startPrice).to.equal(60000n * WAD);
            expect(a.penalty).to.equal(expectedPenalty);
            const ceilFloor = ((a.debt + a.penalty) * WAD + colAmount - 1n) / colAmount;
            expect(a.floorPrice).to.equal(ceilFloor);
            await expect(liqTx).to.emit(liquidationEngine, "AuctionStarted")
                .withArgs(posId, a.startPrice, a.floorPrice, a.debt, a.penalty, colAmount);

            // owner() gets nothing, borrower gets nothing yet, engine custodies the collateral
            expect(await wBTC.balanceOf(owner.address)).to.equal(preOwnerBal);
            expect(await wBTC.balanceOf(borrower.address)).to.equal(preBorrowerBal);
            expect(await wBTC.balanceOf(engineAddr)).to.equal(colAmount);
            expect(await wBTC.balanceOf(await borrowVault.getAddress())).to.equal(0n);

            // Lender claim stays on the books until the auction settles
            expect(await lendingPool.getTotalBorrowed(debtToken)).to.equal(preTotalBorrowed);

            const pos = await borrowVault.getPosition(posId);
            expect(pos.active).to.be.false;
            expect(pos.collateralAmount).to.equal(0n);
            expect(await liquidationEngine.auctionPrice(posId)).to.equal(a.startPrice);
        });

        async function expectSettlement(elapsed: bigint, startSameBlock: boolean) {
            const debtToken = await wUSDC.getAddress();
            const lpAddr = await lendingPool.getAddress();
            const engineAddr = await liquidationEngine.getAddress();
            await wUSDC.mint(liquidator.address, 100000n * 10n**8n);
            await wUSDC.connect(liquidator).approve(engineAddr, ethers.MaxUint256);

            const preLp = await wUSDC.balanceOf(lpAddr);
            const preTreasury = await wUSDC.balanceOf(owner.address);
            const preBorrower = await wUSDC.balanceOf(borrower.address);
            const preBidderUsdc = await wUSDC.balanceOf(liquidator.address);
            const preBidderBtc = await wBTC.balanceOf(liquidator.address);

            let bidTx: any;
            let a: any;
            if (startSameBlock) {
                // t = 0: start and bid land in the same block, so read the auction from AuctionStarted
                let startTx: any;
                await network.provider.send("evm_setAutomine", [false]);
                try {
                    startTx = await liquidationEngine.executeHardLiquidation(posId, { gasLimit: 3_000_000 });
                    bidTx = await liquidationEngine.connect(liquidator).bid(posId, { gasLimit: 3_000_000 });
                    await network.provider.send("evm_mine");
                } finally {
                    await network.provider.send("evm_setAutomine", [true]);
                }
                const startReceipt = await startTx.wait();
                const started = startReceipt.logs
                    .map((l: any) => { try { return liquidationEngine.interface.parseLog(l); } catch { return null; } })
                    .find((l: any) => l?.name === "AuctionStarted");
                const startBlock = await ethers.provider.getBlock(startReceipt.blockNumber);
                a = { ...started.args.toObject(), startedAt: BigInt(startBlock!.timestamp) };
            } else {
                await liquidationEngine.executeHardLiquidation(posId);
                a = await liquidationEngine.auctions(posId);
            }
            expect(a.startedAt).to.be.gt(0n);
            if (!startSameBlock) {
                await network.provider.send("evm_setNextBlockTimestamp", [Number(a.startedAt + elapsed)]);
                bidTx = await liquidationEngine.connect(liquidator).bid(posId);
            }
            const receipt = await bidTx.wait();
            expect(receipt.status).to.equal(1);
            const bidBlock = await ethers.provider.getBlock(receipt.blockNumber);
            expect(BigInt(bidBlock!.timestamp) - a.startedAt).to.equal(elapsed);

            const price = priceAt(a, elapsed);
            const paid = (a.collateral * price) / WAD;
            const toLender = paid < a.debt ? paid : a.debt;
            const rest = paid - toLender;
            const toPenalty = rest < a.penalty ? rest : a.penalty;
            const toBorrower = rest - toPenalty;
            const shortfall = a.debt - toLender;

            await expect(bidTx).to.emit(liquidationEngine, "AuctionSettled")
                .withArgs(posId, liquidator.address, paid, toLender, toPenalty, toBorrower, shortfall);

            expect(await wUSDC.balanceOf(lpAddr) - preLp).to.equal(toLender);
            expect(await wUSDC.balanceOf(owner.address) - preTreasury).to.equal(toPenalty);
            expect(await wUSDC.balanceOf(borrower.address) - preBorrower).to.equal(toBorrower);
            expect(preBidderUsdc - await wUSDC.balanceOf(liquidator.address)).to.equal(paid);
            expect(await wBTC.balanceOf(liquidator.address) - preBidderBtc).to.equal(colAmount);
            expect(await wBTC.balanceOf(engineAddr)).to.equal(0n);
            expect(await lendingPool.getTotalBorrowed(debtToken)).to.equal(0n);
            expect((await liquidationEngine.auctions(posId)).startedAt).to.equal(0n);
            return { a, price, paid, toLender, toPenalty, toBorrower, shortfall };
        }

        it("settles a bid at t = 0 at the oracle price: lender whole, full penalty, surplus to borrower in USDC", async function () {
            const r = await expectSettlement(0n, true);
            expect(r.price).to.equal(60000n * WAD);
            expect(r.paid).to.equal(60000n * 10n**8n);
            expect(r.toLender).to.equal(r.a.debt);
            expect(r.toPenalty).to.equal(r.a.penalty);
            expect(r.toBorrower).to.equal(r.paid - r.a.debt - r.a.penalty);
            expect(r.shortfall).to.equal(0n);
        });

        it("settles a bid at 7.5 min halfway down Phase 1 with a smaller borrower surplus", async function () {
            const r = await expectSettlement(450n, false);
            expect(r.price).to.equal(r.a.startPrice - (r.a.startPrice - r.a.floorPrice) / 2n);
            expect(r.toLender).to.equal(r.a.debt);
            expect(r.toPenalty).to.equal(r.a.penalty);
            expect(r.toBorrower).to.be.gt(0n);
            expect(r.toBorrower).to.be.lt(60000n * 10n**8n - r.a.debt - r.a.penalty);
            expect(r.shortfall).to.equal(0n);
        });

        it("settles a bid at 30 min halfway down Phase 2: all proceeds to lender, shortfall reported", async function () {
            const r = await expectSettlement(1800n, false);
            expect(r.price).to.equal(r.a.floorPrice - r.a.floorPrice / 2n);
            expect(r.toLender).to.equal(r.paid);
            expect(r.toPenalty).to.equal(0n);
            expect(r.toBorrower).to.equal(0n);
            expect(r.shortfall).to.equal(r.a.debt - r.paid);
            expect(r.shortfall).to.be.gt(0n);
        });

        it("rejects bids at 45 min, then expireAuction sends collateral to treasury and writes off the debt", async function () {
            const debtToken = await wUSDC.getAddress();
            const engineAddr = await liquidationEngine.getAddress();
            await liquidationEngine.executeHardLiquidation(posId);
            const a = await liquidationEngine.auctions(posId);

            await network.provider.send("evm_setNextBlockTimestamp", [Number(a.startedAt + AUCTION_END - 1n)]);
            await expect(liquidationEngine.expireAuction(posId)).to.be.revertedWith("Auction still running");

            await network.provider.send("evm_setNextBlockTimestamp", [Number(a.startedAt + AUCTION_END)]);
            await expect(liquidationEngine.connect(liquidator).bid(posId))
                .to.be.revertedWithCustomError(liquidationEngine, "AuctionEnded").withArgs(posId);
            await expect(liquidationEngine.auctionPrice(posId))
                .to.be.revertedWithCustomError(liquidationEngine, "AuctionEnded");

            const preTreasuryBtc = await wBTC.balanceOf(owner.address);
            const preLp = await wUSDC.balanceOf(await lendingPool.getAddress());
            await expect(liquidationEngine.connect(liquidator).expireAuction(posId))
                .to.emit(liquidationEngine, "AuctionExpired").withArgs(posId, a.debt);

            expect(await wBTC.balanceOf(owner.address) - preTreasuryBtc).to.equal(colAmount);
            expect(await wBTC.balanceOf(engineAddr)).to.equal(0n);
            expect(await wBTC.balanceOf(await borrowVault.getAddress())).to.equal(0n);
            expect(await wUSDC.balanceOf(await lendingPool.getAddress())).to.equal(preLp);
            expect(await lendingPool.getTotalBorrowed(debtToken)).to.equal(0n);

            await expect(liquidationEngine.expireAuction(posId))
                .to.be.revertedWithCustomError(liquidationEngine, "NoAuction").withArgs(posId);
            await expect(liquidationEngine.connect(liquidator).bid(posId))
                .to.be.revertedWithCustomError(liquidationEngine, "NoAuction");
        });

        it("treats a second executeHardLiquidation call as a no-op", async function () {
            await liquidationEngine.executeHardLiquidation(posId);
            const before = await liquidationEngine.auctions(posId);
            const engineBtc = await wBTC.balanceOf(await liquidationEngine.getAddress());

            const tx = await liquidationEngine.executeHardLiquidation(posId);
            await expect(tx).to.not.emit(liquidationEngine, "AuctionStarted");
            await expect(tx).to.not.emit(liquidationEngine, "HardLiquidation");

            const after = await liquidationEngine.auctions(posId);
            expect(after.startedAt).to.equal(before.startedAt);
            expect(after.debt).to.equal(before.debt);
            expect(await wBTC.balanceOf(await liquidationEngine.getAddress())).to.equal(engineBtc);
        });

        it("rejects softLiquidate and repay while the position is in auction", async function () {
            await liquidationEngine.executeHardLiquidation(posId);
            await oracle.setPrice(await wBTC.getAddress(), ethers.parseUnits("30000", 18), 8);

            await expect(liquidationEngine.connect(liquidator).softLiquidate(posId, 1000n * 10n**8n))
                .to.be.revertedWithCustomError(liquidationEngine, "PositionNotActive").withArgs(posId);
            await expect(borrowVault.connect(borrower).repay(posId, 1000n * 10n**8n))
                .to.be.revertedWithCustomError(borrowVault, "PositionNotActive").withArgs(posId);
        });

        it("skips Phase 1 for a distressed position even when the pool is funded", async function () {
            await fundStabilityPool(100000n * 10n**8n);
            expect(await stabilityPool.canAbsorb(await wUSDC.getAddress(), borrowAmount * 2n)).to.be.true;
            // BTC crashes to $30k: collateral is worth less than the 40k debt
            await oracle.setPrice(await wBTC.getAddress(), ethers.parseUnits("30000", 18), 8);
            const spUsdc = await wUSDC.balanceOf(await stabilityPool.getAddress());

            const tx = await liquidationEngine.executeHardLiquidation(posId);
            await expect(tx).to.not.emit(liquidationEngine, "HardLiquidation");
            const block = await ethers.provider.getBlock(tx.blockNumber);

            const a = await liquidationEngine.auctions(posId);
            expect(a.startPrice).to.equal(30000n * WAD);
            expect(a.floorPrice).to.equal(a.startPrice);
            expect(a.startedAt).to.equal(BigInt(block!.timestamp) - PHASE1);
            expect(await wUSDC.balanceOf(await stabilityPool.getAddress())).to.equal(spUsdc);

            // Already in Phase 2: price only falls from the oracle price
            await network.provider.send("evm_setNextBlockTimestamp", [block!.timestamp + 900]);
            await network.provider.send("evm_mine");
            expect(await liquidationEngine.auctionPrice(posId)).to.equal(a.floorPrice / 2n);
        });
    });

    describe("forward reserve watermark (soft liquidation routing)", function () {
        const spDeposit = 20000n * 10n**8n;
        const aBorrow = 28000n * 10n**8n;
        const bBorrow = 20000n * 10n**8n;
        let posA: string;

        beforeEach(async function () {
            await fundStabilityPool(spDeposit);
            // A matures in 72h, outside the 48h window, so it never reserves for itself here
            posA = await openFor(borrower, 1n * 10n**8n, aBorrow, 72 * 3600);
        });

        async function softLiquidateA() {
            await oracle.setPrice(await wBTC.getAddress(), ethers.parseUnits("30000", 18), 8);
            await wUSDC.mint(liquidator.address, aBorrow);
            await wUSDC.connect(liquidator).approve(await liquidationEngine.getAddress(), ethers.MaxUint256);
            const spBtc = await wBTC.balanceOf(await stabilityPool.getAddress());
            const keeperBtc = await wBTC.balanceOf(liquidator.address);
            await liquidationEngine.connect(liquidator).softLiquidate(posA, aBorrow);
            return {
                toPool: await wBTC.balanceOf(await stabilityPool.getAddress()) - spBtc,
                toKeeper: await wBTC.balanceOf(liquidator.address) - keeperBtc,
            };
        }

        it("routes A to the keeper path when position B expires within 24h", async function () {
            await openFor(spProvider, 1n * 10n**8n, bBorrow, 12 * 3600);
            const debtToken = await wUSDC.getAddress();
            expect(await borrowVault.reservedDebt(debtToken)).to.equal(bBorrow);
            // Old routing would have let the pool absorb A's 50% close
            expect(await stabilityPool.canAbsorb(debtToken, aBorrow / 2n)).to.be.true;

            const r = await softLiquidateA();
            expect(r.toPool).to.equal(0n);
            expect(r.toKeeper).to.be.gt(0n);
            expect(await wUSDC.balanceOf(await stabilityPool.getAddress())).to.equal(spDeposit);
        });

        it("lets the pool absorb A when B expires after the 48h window", async function () {
            await openFor(spProvider, 1n * 10n**8n, bBorrow, 72 * 3600);
            expect(await borrowVault.reservedDebt(await wUSDC.getAddress())).to.equal(0n);

            const r = await softLiquidateA();
            expect(r.toPool).to.be.gt(0n);
            expect(r.toKeeper).to.equal(0n);
        });

        it("lets the pool absorb A once B is repaid", async function () {
            const posB = await openFor(spProvider, 1n * 10n**8n, bBorrow, 12 * 3600);
            await wUSDC.mint(spProvider.address, 1000n * 10n**8n);
            await wUSDC.connect(spProvider).approve(await borrowVault.getAddress(), ethers.MaxUint256);
            await borrowVault.connect(spProvider).repay(posB, ethers.MaxUint256);
            expect(await borrowVault.reservedDebt(await wUSDC.getAddress())).to.equal(0n);

            const r = await softLiquidateA();
            expect(r.toPool).to.be.gt(0n);
            expect(r.toKeeper).to.equal(0n);
        });
    });

    describe("partial soft liquidation principal sync (reducePrincipal)", function () {
        it("lets the borrower fully repay after a partial soft liquidation and clears totalBorrowed", async function () {
            const debtToken = await wUSDC.getAddress();
            const borrowAmount = 35000n * 10n**8n;
            const posId = await openFor(borrower, 1n * 10n**8n, borrowAmount, 86400);
            await oracle.setPrice(await wBTC.getAddress(), ethers.parseUnits("45000", 18), 8);

            await wUSDC.mint(liquidator.address, borrowAmount);
            await wUSDC.connect(liquidator).approve(await liquidationEngine.getAddress(), ethers.MaxUint256);
            await liquidationEngine.connect(liquidator).softLiquidate(posId, borrowAmount);

            // Vault principal now matches the InterestEngine principal
            const pos = await borrowVault.getPosition(posId);
            const ie = await interestEngine.positions(posId);
            expect(pos.borrowAmount).to.equal(ie.principal);
            expect(pos.borrowAmount).to.be.lt(borrowAmount);
            expect(await lendingPool.getTotalBorrowed(debtToken)).to.equal(pos.borrowAmount);
            expect(await borrowVault.reservedDebt(debtToken)).to.equal(pos.borrowAmount);

            await wUSDC.mint(borrower.address, 1000n * 10n**8n);
            await wUSDC.connect(borrower).approve(await borrowVault.getAddress(), ethers.MaxUint256);
            await borrowVault.connect(borrower).repay(posId, ethers.MaxUint256);

            expect((await borrowVault.getPosition(posId)).active).to.be.false;
            expect(await lendingPool.getTotalBorrowed(debtToken)).to.equal(0n);
            expect(await borrowVault.reservedDebt(debtToken)).to.equal(0n);
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
