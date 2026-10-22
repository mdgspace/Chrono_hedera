import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

const POLL_MS = 30_000;
const LOG_CHUNK = 1_000;

async function main() {
    const deployment = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../deployments/testnet.json"), "utf8"));
    if (!deployment.MaturityCronScheduler || !deployment.ScheduleRecoveryQueue) {
        throw new Error("Cron deployment addresses are missing");
    }
    if (!process.env.KEEPER_PRIVATE_KEY || !process.env.CRON_FROM_BLOCK) {
        throw new Error("Set KEEPER_PRIVATE_KEY and CRON_FROM_BLOCK (the cron deployment block)");
    }

    const signer = new ethers.Wallet(process.env.KEEPER_PRIVATE_KEY, ethers.provider);
    const scheduler = await ethers.getContractAt("MaturityCronScheduler", deployment.MaturityCronScheduler, signer);
    const queue = await ethers.getContractAt("ScheduleRecoveryQueue", deployment.ScheduleRecoveryQueue, signer);
    const seen = new Set<string>();
    let fromBlock = Number(process.env.CRON_FROM_BLOCK);
    if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) throw new Error("Invalid CRON_FROM_BLOCK");

    while (true) {
        try {
            const latest = await ethers.provider.getBlockNumber();
            for (let first = fromBlock; first <= latest; first += LOG_CHUNK) {
                const last = Math.min(first + LOG_CHUNK - 1, latest);
                const opened = await scheduler.queryFilter(scheduler.filters.JobCreated(), first, last);
                for (const event of opened) {
                    if ("args" in event) seen.add(event.args.positionId);
                }
            }
            fromBlock = latest + 1;

            // Queue removal swaps in the last item, so keep the same index after success.
            for (let index = 0; index < Number(await queue.pendingCount());) {
                const positionId = await queue.pendingAt(index);
                try {
                    const tx = await queue.retry(positionId);
                    await tx.wait();
                    console.log("Retried pending cron job", positionId, tx.hash);
                    if ((await queue.pending(positionId)).indexPlusOne === 0n) continue;
                } catch (error) {
                    console.error("Cron queue retry failed", positionId, error);
                }
                index++;
            }

            const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
            for (const positionId of seen) {
                const job = await scheduler.jobs(positionId);
                if (job.status !== 1n || job.nextExecutionAt > now) continue;
                try {
                    const tx = await scheduler.advance(positionId, job.generation);
                    await tx.wait();
                    console.log("Advanced overdue cron job", positionId, tx.hash);
                } catch (error) {
                    console.error("Overdue cron job needs attention", positionId, error);
                }
            }

            const active = await scheduler.activeJobCount();
            const reserve = await scheduler.reservePerJob();
            const balanceTinybar = (await ethers.provider.getBalance(await scheduler.getAddress())) / 10n ** 10n;
            if (balanceTinybar < active * reserve) {
                console.error("Cron HBAR below active job reserve", { balanceTinybar: balanceTinybar.toString(), requiredTinybar: (active * reserve).toString() });
            }
        } catch (error) {
            console.error("Cron keeper poll failed", error);
        }
        await new Promise(resolve => setTimeout(resolve, POLL_MS));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
