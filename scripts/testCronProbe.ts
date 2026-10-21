import { ethers, network } from "hardhat";

async function main() {
    if (network.name !== "testnet") throw new Error("Run this canary only on Hedera testnet");
    const [deployer] = await ethers.getSigners();
    const probe = await (await ethers.getContractFactory("CronProbe")).deploy();
    await probe.waitForDeployment();
    const address = await probe.getAddress();
    await (await deployer.sendTransaction({
        to: address, value: ethers.parseEther(process.env.PROBE_HBAR || "5")
    })).wait();
    const start = await probe.start();
    const receipt = await start.wait();
    console.log("Probe contract:", address);
    console.log("First HSS schedule:", await probe.firstSchedule());
    console.log("Start transaction:", start.hash);

    const deadline = Date.now() + 4 * 60_000;
    const executed = new Set<number>();
    while (Date.now() < deadline && executed.size < 2) {
        const latest = await ethers.provider.getBlockNumber();
        const events = await probe.queryFilter(probe.filters.ProbeExecuted(), receipt!.blockNumber, latest);
        for (const event of events) {
            if ("args" in event) executed.add(Number(event.args.generation));
        }
        if (executed.size < 2) await new Promise(resolve => setTimeout(resolve, 5_000));
    }
    console.log("Second HSS schedule:", await probe.secondSchedule());
    console.log("Executed generations:", [...executed].sort());
    if (!executed.has(1) || !executed.has(2)) {
        throw new Error("Two-hop HSS canary did not complete; inspect child results and payer balance");
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
