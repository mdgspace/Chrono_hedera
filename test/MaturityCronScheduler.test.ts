import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("MaturityCronScheduler (one minute horizon)", function () {
  async function fixture(reserve = 0n) {
    const [owner, keeper] = await ethers.getSigners();
    const vault = await (await ethers.getContractFactory("MockCronBorrowVault")).deploy();
    const liquidation = await (await ethers.getContractFactory("MockCronLiquidation")).deploy(await vault.getAddress());
    const scheduler = await (await ethers.getContractFactory("MockMaturityCronScheduler"))
      .deploy(await vault.getAddress(), await liquidation.getAddress(), 60, 5, 15, reserve);
    const queue = await (await ethers.getContractFactory("ScheduleRecoveryQueue")).deploy(await scheduler.getAddress());
    await vault.setScheduler(await scheduler.getAddress());
    await scheduler.setRecoveryQueue(await queue.getAddress());
    return { owner, keeper, vault, liquidation, scheduler, queue };
  }

  const id = (n: number) => ethers.zeroPadValue(ethers.toBeHex(n), 32);

  it("T01 creates a direct terminal schedule inside sixty seconds", async function () {
    const { vault, liquidation, scheduler } = await fixture();
    await vault.create(id(1), 20);
    const position = await vault.getPosition(id(1));
    const job = await scheduler.jobs(id(1));
    expect(job.status).to.equal(1n);
    expect(job.generation).to.equal(1n);
    expect(job.nextExecutionAt).to.equal(job.liquidationAt);
    expect(await scheduler.lastTarget()).to.equal(await liquidation.getAddress());
    expect(position.scheduledTxAddress).to.equal(job.pendingSchedule);
  });

  it("T02 chains from a 45 second intermediate callback with matching generation", async function () {
    const { vault, scheduler } = await fixture();
    await vault.create(id(2), 85);
    const first = await scheduler.jobs(id(2));
    expect(first.nextExecutionAt - (first.maturityAt - 85n)).to.equal(45n);
    const decoded = scheduler.interface.decodeFunctionData("advance", await scheduler.lastCallData());
    expect(decoded[0]).to.equal(id(2));
    expect(decoded[1]).to.equal(1n);

    await time.increaseTo(first.nextExecutionAt - 1n);
    await scheduler.advance(id(2), 1);
    const second = await scheduler.jobs(id(2));
    expect(second.generation).to.equal(2n);
    expect(second.pendingSchedule).not.to.equal(first.pendingSchedule);
    expect(second.liquidationAt).to.equal(first.liquidationAt);
    expect(second.nextExecutionAt - BigInt(await time.latest())).to.be.lessThanOrEqual(60n);
    const nextPayload = scheduler.interface.decodeFunctionData("advance", await scheduler.lastCallData());
    expect(nextPayload[1]).to.equal(2n);
  });

  it("keeps a 120 day maturity fixed across a minute hop and a late keeper rescue", async function () {
    const { vault, scheduler, liquidation } = await fixture();
    await vault.create(id(11), 120 * 86400);
    const first = await scheduler.jobs(id(11));
    await time.increaseTo(first.nextExecutionAt - 1n);
    await scheduler.advance(id(11), 1);
    const second = await scheduler.jobs(id(11));
    expect(second.liquidationAt).to.equal(first.liquidationAt);
    expect(second.nextExecutionAt).to.be.lessThanOrEqual(first.nextExecutionAt + 60n);
    await time.increaseTo(first.liquidationAt - 1n);
    await scheduler.advance(id(11), 2);
    expect(await liquidation.calls()).to.equal(1n);
    expect((await scheduler.jobs(id(11))).status).to.equal(3n);
  });

  it("T03 and T04 classify the horizon by execution second and use bounded later capacity", async function () {
    const { vault, scheduler } = await fixture();
    await vault.create(id(3), 53); // liquidation second is creation + 60
    const boundary = await scheduler.jobs(id(3));
    expect(boundary.nextExecutionAt - BigInt((await vault.getPosition(id(3))).startTime)).to.equal(45n);

    const now = await time.latest();
    await scheduler.setBlockedSecond(now + 47); // setter and create each mine one second
    await vault.create(id(4), 85);
    const probed = await scheduler.jobs(id(4));
    expect(probed.liquidationAt - BigInt((await vault.getPosition(id(4))).startTime)).to.equal(92n);
    expect(probed.nextExecutionAt - BigInt((await vault.getPosition(id(4))).startTime)).to.equal(46n);
  });

  it("T05 records failed existing hops and lets any keeper retry", async function () {
    const { vault, scheduler, queue, keeper } = await fixture();
    await vault.create(id(6), 85);
    const first = await scheduler.jobs(id(6));
    await scheduler.setAvailable(false);
    await time.increaseTo(first.nextExecutionAt - 1n);
    await scheduler.advance(id(6), 1);
    const failed = await scheduler.jobs(id(6));
    expect(failed.status).to.equal(2n);
    expect(failed.generation).to.equal(1n);
    expect(failed.pendingSchedule).to.equal(ethers.ZeroAddress);
    expect(await queue.pendingCount()).to.equal(1n);
    expect(await queue.pendingAt(0)).to.equal(id(6));

    await scheduler.setAvailable(true);
    await queue.connect(keeper).getFunction("retry")(id(6));
    expect((await scheduler.jobs(id(6))).generation).to.equal(2n);
    expect((await scheduler.jobs(id(6))).status).to.equal(1n);
    expect(await queue.pendingCount()).to.equal(0n);
  });

  it("T05 records an HSS response code and rejects unauthorized queue writes", async function () {
    const { vault, scheduler, queue, keeper } = await fixture();
    await expect(queue.connect(keeper).getFunction("markPending")(id(10), 1, 42))
      .to.be.revertedWithCustomError(queue, "OnlyScheduler");
    await scheduler.setCreateCode(42);
    await expect(vault.create(id(10), 85)).to.be.revertedWithCustomError(scheduler, "ScheduleCallFailed");
    await scheduler.setCreateCode(22);
    await vault.create(id(10), 85);
    const first = await scheduler.jobs(id(10));
    await scheduler.setCreateCode(42);
    await time.increaseTo(first.nextExecutionAt - 1n);
    await scheduler.advance(id(10), 1);
    expect((await queue.pending(id(10))).responseCode).to.equal(42n);
  });

  it("T05 rejects origination without a schedule or funded reserve", async function () {
    const { vault, scheduler } = await fixture(1n);
    await expect(vault.create(id(7), 85)).to.be.revertedWithCustomError(scheduler, "InsufficientHbarReserve");
    await (await ethers.getSigners())[0].sendTransaction({ to: await scheduler.getAddress(), value: 1n });
    await scheduler.setAvailable(false);
    await expect(vault.create(id(7), 85)).to.be.revertedWithCustomError(scheduler, "NoScheduleCapacity");
    expect((await vault.getPosition(id(7))).active).to.equal(false);
  });

  it("T05 lets a keeper settle an overdue failed hop after liquidation time", async function () {
    const { vault, scheduler, queue, liquidation } = await fixture();
    await vault.create(id(9), 85);
    const first = await scheduler.jobs(id(9));
    await scheduler.setAvailable(false);
    await time.increaseTo(first.nextExecutionAt - 1n);
    await scheduler.advance(id(9), 1);
    await time.increaseTo(first.liquidationAt - 1n);
    await queue.retry(id(9));
    expect(await liquidation.calls()).to.equal(1n);
    expect((await scheduler.jobs(id(9))).status).to.equal(3n);
    expect(await queue.pendingCount()).to.equal(0n);
    expect((await vault.getPosition(id(9))).active).to.equal(false);
  });

  it("T06 to T08 ignores stale callbacks and closes after repayment", async function () {
    const { vault, scheduler } = await fixture();
    await vault.create(id(8), 85);
    const first = await scheduler.jobs(id(8));
    await expect(scheduler.advance(id(8), 1)).to.be.revertedWithCustomError(scheduler, "JobNotDue");
    await time.increaseTo(first.nextExecutionAt - 1n);
    await scheduler.advance(id(8), 1);
    expect(await scheduler.advance.staticCall(id(8), 1)).to.equal(false);
    await vault.close(id(8));
    expect((await scheduler.jobs(id(8))).status).to.equal(3n);
    expect(await scheduler.advance.staticCall(id(8), 2)).to.equal(false);
  });
});
