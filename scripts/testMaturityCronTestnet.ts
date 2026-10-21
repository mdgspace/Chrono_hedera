import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    if (network.name !== "testnet") throw new Error("Run only on Hedera testnet");
    const [deployer] = await ethers.getSigners();
    const vault = await (await ethers.getContractFactory("MockCronBorrowVault")).deploy();
    await vault.waitForDeployment();
    const liquidation = await (await ethers.getContractFactory("MockCronLiquidation")).deploy(await vault.getAddress());
    await liquidation.waitForDeployment();
    const scheduler = await (await ethers.getContractFactory("MaturityCronScheduler"))
        .deploy(await vault.getAddress(), await liquidation.getAddress(), 60, 5, 15, 3_000_000, ethers.parseUnits("1", 8));
    await scheduler.waitForDeployment();
    const queue = await (await ethers.getContractFactory("ScheduleRecoveryQueue")).deploy(await scheduler.getAddress());
    await queue.waitForDeployment();
    const addresses = {
        vault: await vault.getAddress(), liquidation: await liquidation.getAddress(),
        scheduler: await scheduler.getAddress(), queue: await queue.getAddress()
    };
    console.log("Canary contracts:", addresses);
    fs.writeFileSync(path.resolve(__dirname, "../deployments/testnet-cron-canary.json"), JSON.stringify(addresses, null, 2));

    await (await vault.setScheduler(addresses.scheduler)).wait();
    await (await scheduler.setRecoveryQueue(addresses.queue)).wait();
    const initialFunding = ethers.parseEther(process.env.CRON_TEST_HBAR || "20");
    await (await deployer.sendTransaction({ to: addresses.scheduler, value: initialFunding })).wait();
    const positionId = ethers.zeroPadValue(ethers.toBeHex(1), 32);
    const openTx = await vault.create(positionId, 85);
    await openTx.wait();
    console.log("Position:", positionId, "open tx:", openTx.hash);

    const deadline = Date.now() + 5 * 60_000;
    let lastState = "";
    let keeperInterventions = 0;
    while (Date.now() < deadline) {
        const job = await scheduler.jobs(positionId);
        const state = `${job.status}:${job.generation}:${job.pendingSchedule}:${job.nextExecutionAt}`;
        if (state !== lastState) {
            console.log("Job:", state, "pending queue:", (await queue.pendingCount()).toString(),
                "HBAR:", ethers.formatEther(await ethers.provider.getBalance(addresses.scheduler)));
            lastState = state;
        }
        if (job.status === 3n && await liquidation.calls() === 1n) {
            const balance = (await ethers.provider.getBalance(addresses.scheduler)) / 10n ** 10n;
            console.log("HBAR used by canary:", ethers.formatEther(initialFunding - balance * 10n ** 10n));
            await (await scheduler.withdrawExcess(deployer.address, balance)).wait();
            console.log("Keeper interventions:", keeperInterventions);
            console.log("HSS chain settled one loan; unused HBAR returned");
            if (keeperInterventions !== 0) throw new Error("Canary needed keeper recovery");
            return;
        }
        if (job.status === 2n) {
            try {
                const tx = await queue.retry(positionId);
                await tx.wait();
                keeperInterventions++;
                console.log("Keeper retry:", tx.hash);
            } catch (error) {
                console.error("Keeper retry failed:", error);
            }
        } else if (job.status === 1n) {
            const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
            if (now > job.nextExecutionAt + 10n) {
                try {
                    const tx = await scheduler.advance(positionId, job.generation);
                    await tx.wait();
                    keeperInterventions++;
                    console.log("Overdue keeper advance:", tx.hash);
                } catch (error) {
                    console.error("Overdue advance failed:", error);
                }
            }
        }
        await new Promise(resolve => setTimeout(resolve, 5_000));
    }
    throw new Error("Cron canary timed out; inspect recorded contract addresses and HSS child results");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
