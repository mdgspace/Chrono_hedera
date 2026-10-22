import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    if (network.name !== "testnet") throw new Error("Use Hedera testnet");
    const addresses = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../deployments/testnet-cron-canary.json"), "utf8"));
    const vault = await ethers.getContractAt("MockCronBorrowVault", addresses.vault);
    const scheduler = await ethers.getContractAt("MaturityCronScheduler", addresses.scheduler);
    const queue = await ethers.getContractAt("ScheduleRecoveryQueue", addresses.queue);
    const id = ethers.zeroPadValue(ethers.toBeHex(1), 32);
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    console.log("Timestamp:", now);
    console.log("Vault scheduler:", await vault.scheduler());
    console.log("Recovery queue:", await scheduler.recoveryQueue());
    console.log("Cron HBAR:", ethers.formatEther(await ethers.provider.getBalance(addresses.scheduler)));
    console.log("Position:", await vault.getPosition(id));
    console.log("Job:", await scheduler.jobs(id));
    console.log("Pending count:", (await queue.pendingCount()).toString());
    const latest = await ethers.provider.getBlockNumber();
    const from = Math.max(0, latest - 1000);
    for (const event of await scheduler.queryFilter(scheduler.filters.HopScheduled(), from, latest)) {
        if ("args" in event) console.log("Hop scheduled:", event.args.generation.toString(), event.args.executionAt.toString(), event.args.terminal, event.args.scheduleAddress);
    }
    for (const event of await scheduler.queryFilter(scheduler.filters.HopFailed(), from, latest)) {
        if ("args" in event) console.log("Hop failed:", event.args.generation.toString(), "HSS code", event.args.responseCode.toString(), "tx", event.transactionHash);
    }
    const hss = new ethers.Contract("0x000000000000000000000000000000000000016b", [
        "function hasScheduleCapacity(uint256,uint256) view returns (bool)"
    ], ethers.provider);
    for (const offset of [45, 46, 60]) {
        try { console.log("HSS capacity at +" + offset, await hss.hasScheduleCapacity(now + offset, 3_000_000)); }
        catch (error) { console.log("HSS capacity read failed at +" + offset, String(error)); }
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
