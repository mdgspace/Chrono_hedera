import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { SchedulerEngine, MockSchedulerEngine } from "../typechain-types";

describe("SchedulerEngine", function () {
    let schedulerEngine: SchedulerEngine;
    let owner: HardhatEthersSigner;
    let borrowVault: HardhatEthersSigner;
    let liquidationEngine: HardhatEthersSigner;
    let user: HardhatEthersSigner;

    beforeEach(async function () {
        [owner, borrowVault, liquidationEngine, user] = await ethers.getSigners();
        const SchedulerEngineFactory = await ethers.getContractFactory("SchedulerEngine");
        schedulerEngine = (await SchedulerEngineFactory.deploy()) as unknown as SchedulerEngine;
    });

    describe("Constants & Configuration", function () {
        it("should expose GRACE_PERIOD constant equal to 900", async function () {
            expect(await schedulerEngine.GRACE_PERIOD()).to.equal(900n);
        });
    });

    describe("Access Control", function () {
        it("should restrict initialize to owner", async function () {
            await expect(
                schedulerEngine.connect(user).initialize(liquidationEngine.address, borrowVault.address)
            )
                .to.be.revertedWithCustomError(schedulerEngine, "OwnableUnauthorizedAccount")
                .withArgs(user.address);

            await schedulerEngine.connect(owner).initialize(liquidationEngine.address, borrowVault.address);
            expect(await schedulerEngine.liquidationEngine()).to.equal(liquidationEngine.address);
            expect(await schedulerEngine.borrowVault()).to.equal(borrowVault.address);
        });

        it("should restrict setExecuteGasLimit to owner, update gas limit, and emit event", async function () {
            const newGasLimit = 4_000_000n;

            await expect(
                schedulerEngine.connect(user).setExecuteGasLimit(newGasLimit)
            )
                .to.be.revertedWithCustomError(schedulerEngine, "OwnableUnauthorizedAccount")
                .withArgs(user.address);

            await expect(schedulerEngine.connect(owner).setExecuteGasLimit(newGasLimit))
                .to.emit(schedulerEngine, "GasLimitUpdated")
                .withArgs(newGasLimit);

            expect(await schedulerEngine.executeGasLimit()).to.equal(newGasLimit);
        });

        it("should revert scheduleHardLiquidation if not borrowVault with ErrorLib.Unauthorized", async function () {
            await schedulerEngine.connect(owner).initialize(liquidationEngine.address, borrowVault.address);

            const positionId = ethers.encodeBytes32String("pos-1");
            const expiryTimestamp = 1_700_000_000;

            await expect(
                schedulerEngine.connect(user).scheduleHardLiquidation(positionId, expiryTimestamp)
            )
                .to.be.revertedWithCustomError(schedulerEngine, "Unauthorized")
                .withArgs(user.address, borrowVault.address);

            await expect(
                schedulerEngine.connect(owner).scheduleHardLiquidation(positionId, expiryTimestamp)
            )
                .to.be.revertedWithCustomError(schedulerEngine, "Unauthorized")
                .withArgs(owner.address, borrowVault.address);
        });

        it("should revert scheduleHardLiquidation if expiry exceeds 60 days from block.timestamp", async function () {
            await schedulerEngine.connect(owner).initialize(liquidationEngine.address, borrowVault.address);

            const positionId = ethers.encodeBytes32String("pos-1");
            const block = await ethers.provider.getBlock("latest");
            const currentTimestamp = block!.timestamp;
            const expiryTimestamp = currentTimestamp + 60 * 86400 + 10;

            await expect(
                schedulerEngine.connect(borrowVault).scheduleHardLiquidation(positionId, expiryTimestamp)
            ).to.be.revertedWithCustomError(schedulerEngine, "DurationExceedsScheduleLimit");
        });

        it("should revert cancelSchedule if not borrowVault with ErrorLib.Unauthorized", async function () {
            await schedulerEngine.connect(owner).initialize(liquidationEngine.address, borrowVault.address);

            const positionId = ethers.encodeBytes32String("pos-1");

            await expect(
                schedulerEngine.connect(user).cancelSchedule(positionId)
            )
                .to.be.revertedWithCustomError(schedulerEngine, "Unauthorized")
                .withArgs(user.address, borrowVault.address);

            await expect(
                schedulerEngine.connect(owner).cancelSchedule(positionId)
            )
                .to.be.revertedWithCustomError(schedulerEngine, "Unauthorized")
                .withArgs(owner.address, borrowVault.address);
        });
    });

    describe("Index Keeper & Dev Toggle", function () {
        it("should allow owner to setInterestEngine and restrict non-owner", async function () {
            await expect(
                schedulerEngine.connect(user).setInterestEngine(user.address)
            ).to.be.revertedWithCustomError(schedulerEngine, "OwnableUnauthorizedAccount");

            await schedulerEngine.connect(owner).setInterestEngine(user.address);
            expect(await schedulerEngine.interestEngine()).to.equal(user.address);
        });

        it("should allow owner to setIndexKeeperEnabled and emit IndexKeeperToggled", async function () {
            await expect(
                schedulerEngine.connect(user).setIndexKeeperEnabled(true)
            ).to.be.revertedWithCustomError(schedulerEngine, "OwnableUnauthorizedAccount");

            await expect(schedulerEngine.connect(owner).setIndexKeeperEnabled(true))
                .to.emit(schedulerEngine, "IndexKeeperToggled")
                .withArgs(true);
            expect(await schedulerEngine.isIndexKeeperEnabled()).to.be.true;

            await expect(schedulerEngine.connect(owner).setIndexKeeperEnabled(false))
                .to.emit(schedulerEngine, "IndexKeeperToggled")
                .withArgs(false);
            expect(await schedulerEngine.isIndexKeeperEnabled()).to.be.false;
        });

        it("should executePeriodicIndexUpdate and halt when isIndexKeeperEnabled == false (0 gas recurrence)", async function () {
            const RegistryFactory = await ethers.getContractFactory("AssetRegistry");
            const reg = await RegistryFactory.deploy(owner.address);
            const PoolFactory = await ethers.getContractFactory("MockLendingPool");
            const pool = await PoolFactory.deploy();
            const EngineFactory = await ethers.getContractFactory("InterestEngine");
            const eng = await EngineFactory.deploy(await pool.getAddress(), await reg.getAddress(), owner.address);

            await schedulerEngine.connect(owner).setInterestEngine(await eng.getAddress());
            expect(await schedulerEngine.isIndexKeeperEnabled()).to.be.false;

            const nextSchedule = await schedulerEngine.executePeriodicIndexUpdate.staticCall();
            expect(nextSchedule).to.equal(ethers.ZeroAddress);

            await schedulerEngine.executePeriodicIndexUpdate();
            expect(await schedulerEngine.currentIndexSchedule()).to.equal(ethers.ZeroAddress);
        });

        it("should stopIndexKeeper, set flag to false, and reset currentIndexSchedule", async function () {
            await expect(
                schedulerEngine.connect(user).stopIndexKeeper()
            ).to.be.revertedWithCustomError(schedulerEngine, "OwnableUnauthorizedAccount");

            await schedulerEngine.connect(owner).setIndexKeeperEnabled(true);
            expect(await schedulerEngine.isIndexKeeperEnabled()).to.be.true;

            await expect(schedulerEngine.connect(owner).stopIndexKeeper())
                .to.emit(schedulerEngine, "IndexKeeperToggled")
                .withArgs(false);
            expect(await schedulerEngine.isIndexKeeperEnabled()).to.be.false;
            expect(await schedulerEngine.currentIndexSchedule()).to.equal(ethers.ZeroAddress);
        });
    });
});

describe("MockSchedulerEngine", function () {
    let mockScheduler: MockSchedulerEngine;

    beforeEach(async function () {
        const MockSchedulerEngineFactory = await ethers.getContractFactory("MockSchedulerEngine");
        mockScheduler = (await MockSchedulerEngineFactory.deploy()) as unknown as MockSchedulerEngine;
    });

    it("should record lastPositionId and lastExpiryTimestamp upon scheduleHardLiquidation", async function () {
        const positionId = ethers.encodeBytes32String("pos-mock-1");
        const expiryTimestamp = 1_700_000_000n;

        const returnedAddress = await mockScheduler.scheduleHardLiquidation.staticCall(
            positionId,
            expiryTimestamp
        );
        expect(returnedAddress).to.equal("0x0000000000000000000000000000000000000123");

        await mockScheduler.scheduleHardLiquidation(positionId, expiryTimestamp);

        expect(await mockScheduler.lastPositionId()).to.equal(positionId);
        expect(await mockScheduler.lastExpiryTimestamp()).to.equal(expiryTimestamp);
    });
});
