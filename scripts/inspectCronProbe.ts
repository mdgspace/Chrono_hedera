import { ethers, network } from "hardhat";

async function main() {
    if (network.name !== "testnet") throw new Error("Use Hedera testnet");
    const address = process.env.PROBE_ADDRESS;
    if (!address) throw new Error("Set PROBE_ADDRESS");
    const probe = await ethers.getContractAt("CronProbe", address);
    const first = await probe.firstSchedule();
    const second = await probe.secondSchedule();
    console.log("Probe:", address);
    console.log("Next generation:", (await probe.nextGeneration()).toString());
    console.log("First schedule:", first);
    console.log("Second schedule:", second);
    console.log("Probe HBAR:", ethers.formatEther(await ethers.provider.getBalance(address)));
    const toBlock = await ethers.provider.getBlockNumber();
    const fromBlock = Number(process.env.PROBE_FROM_BLOCK || Math.max(0, toBlock - 1000));
    for (const event of await probe.queryFilter(probe.filters.ProbeScheduled(), fromBlock, toBlock)) {
        if ("args" in event) console.log("Scheduled:", Number(event.args.generation), "for", event.args.requestedSecond.toString(), "tx", event.transactionHash);
    }
    for (const event of await probe.queryFilter(probe.filters.ProbeExecuted(), fromBlock, toBlock)) {
        if ("args" in event) console.log("Executed:", Number(event.args.generation), "at", event.args.actualSecond.toString(), "tx", event.transactionHash);
    }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
