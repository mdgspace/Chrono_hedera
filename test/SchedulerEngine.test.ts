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
