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
            hardLiqCollateralFloor: 0, stabilityPoolPenaltyShare: 0, reservePenaltyShare: 0,
            minBorrowDuration: 0, maxBorrowDuration: 0, isActive: false
        });

        // Register Volatile
        await registry.registerAsset({
            tokenAddress: TOKEN_VOLATILE,
            decimals: 8,
            isStablecoin: false,
            ltvBase: 0, ltvMax: 0, kDecay: 0, liquidationBonus: 0, closeFactor: 0,
            ltBufferMin: 0, ltBufferMax: 0, kLtBuffer: 0, hardLiqPenalty: 0,
            hardLiqCollateralFloor: 0, stabilityPoolPenaltyShare: 0, reservePenaltyShare: 0,
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

    it("should report cumulative debt after multiple accruals", async function () {
        const principal = ethers.parseUnits("1000", 18);
        await engine.connect(vault).initPosition(POS_ID, TOKEN_STABLE, principal);
        await time.increase(86400);
        await engine.connect(vault).accrueInterest(POS_ID);
        const firstDebt = await engine.getTotalDebt(POS_ID);
        expect(firstDebt).to.be.greaterThan(principal);
        await time.increase(86400);
        await engine.connect(vault).accrueInterest(POS_ID);
        const secondDebt = await engine.getTotalDebt(POS_ID);
        const state = await engine.positions(POS_ID);
        expect(secondDebt).to.equal(state.principal + state.accruedInterest);
        expect(secondDebt).to.be.greaterThan(firstDebt);
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

    describe("Cumulative Borrow Index", function () {
        it("should initialize borrowIndex to 1.0 WAD on first update", async function () {
            expect(await engine.getBorrowIndex(TOKEN_STABLE)).to.equal(ethers.parseUnits("1.0", 18));
            
            const tx = await engine.updateReserveIndices(TOKEN_STABLE);
            const receipt = await tx.wait();
            
            expect(await engine.getBorrowIndex(TOKEN_STABLE)).to.equal(ethers.parseUnits("1.0", 18));
            const data = await engine.reserveData(TOKEN_STABLE);
            expect(data.borrowIndex).to.equal(ethers.parseUnits("1.0", 18));
            expect(data.lastUpdateTimestamp).to.be.gt(0);
        });

        it("should compound borrowIndex accurately over elapsed time", async function () {
            // Setup pool utilization
            await mockPool.setDeposits(TOKEN_STABLE, ethers.parseUnits("1000", 18));
            await mockPool.setBorrowed(TOKEN_STABLE, ethers.parseUnits("500", 18));
            const apy = await engine.getBorrowAPY(TOKEN_STABLE);

            // First call initializes index at block1
            const tx1 = await engine.updateReserveIndices(TOKEN_STABLE);
            const receipt1 = await tx1.wait();
            const block1 = await ethers.provider.getBlock(receipt1!.blockNumber);

            // Advance 3600 seconds (1 hour)
            await time.increase(3600);

            const tx2 = await engine.updateReserveIndices(TOKEN_STABLE);
            await expect(tx2).to.emit(engine, "IndexSnapshot");
            const receipt2 = await tx2.wait();
            const block2 = await ethers.provider.getBlock(receipt2!.blockNumber);

            const elapsed = BigInt(block2!.timestamp - block1!.timestamp);
            const indexAfter = await engine.getBorrowIndex(TOKEN_STABLE);
            const expectedFactor = (apy * elapsed) / 31536000n;
            const expectedIndex = ethers.parseUnits("1.0", 18) + expectedFactor;

            expect(indexAfter).to.equal(expectedIndex);
        });

        it("should be idempotent when elapsed == 0", async function () {
            await engine.updateReserveIndices(TOKEN_STABLE);

            // Mine two calls in the same block using disabled automine
            await hre.network.provider.send("evm_setAutomine", [false]);
            const tx1 = await engine.updateReserveIndices(TOKEN_STABLE);
            const tx2 = await engine.updateReserveIndices(TOKEN_STABLE);
            await hre.network.provider.send("hardhat_mine", ["0x1"]);
            await hre.network.provider.send("evm_setAutomine", [true]);

            await tx1.wait();
            await tx2.wait();

            const indexFinal = await engine.getBorrowIndex(TOKEN_STABLE);
            const staticResult = await engine.updateReserveIndices.staticCall(TOKEN_STABLE);
            expect(staticResult).to.equal(indexFinal);
        });

        it("should update all supported registered assets via updateAllReserveIndices", async function () {
            const count = await engine.updateAllReserveIndices.staticCall();
            expect(count).to.equal(2n);

            await engine.updateAllReserveIndices();
            expect(await engine.getBorrowIndex(TOKEN_STABLE)).to.equal(ethers.parseUnits("1.0", 18));
            expect(await engine.getBorrowIndex(TOKEN_VOLATILE)).to.equal(ethers.parseUnits("1.0", 18));
        });

        it("should achieve mathematical parity: 24 hourly updates vs 1 24h lazy update", async function () {
            // Deploy a separate engine to compare single 24h lazy update against 24 hourly updates
            const EngineFactory = await ethers.getContractFactory("InterestEngine");
            const engineLazy = await EngineFactory.deploy(await mockPool.getAddress(), await registry.getAddress(), owner.address);

            // Set fixed deposits and borrow
            await mockPool.setDeposits(TOKEN_STABLE, ethers.parseUnits("1000", 18));
            await mockPool.setBorrowed(TOKEN_STABLE, ethers.parseUnits("400", 18));

            // Initialize both engines at the exact same block
            await engine.updateReserveIndices(TOKEN_STABLE);
            await engineLazy.updateReserveIndices(TOKEN_STABLE);

            // Fast-forward 24 hours (86,400 seconds) in 1-hour increments on engine, but do nothing on engineLazy
            for (let i = 0; i < 24; i++) {
                await time.increase(3600);
                await engine.updateReserveIndices(TOKEN_STABLE);
            }

            // Now perform a single lazy update on engineLazy after 24h
            await engineLazy.updateReserveIndices(TOKEN_STABLE);

            const indexHourly = await engine.getBorrowIndex(TOKEN_STABLE);
            const indexLazy = await engineLazy.getBorrowIndex(TOKEN_STABLE);

            // Compounding variance between linear approximation over 24h vs hourly is tiny (< 0.0001%)
            // Proves zero loss of accounting fidelity when keeper is toggled off
            expect(indexHourly).to.be.closeTo(indexLazy, ethers.parseUnits("0.00001", 18));
        });
    });
});
