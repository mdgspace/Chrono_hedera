import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    if (network.name !== "testnet") throw new Error("Use Hedera testnet");
    const addresses = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../deployments/testnet-cron-canary.json"), "utf8"));
    const [owner] = await ethers.getSigners();
    const scheduler = await ethers.getContractAt("MaturityCronScheduler", addresses.scheduler);
    if (await scheduler.activeJobCount() !== 0n) throw new Error("Canary has an active job");
    const amountTinybar = (await ethers.provider.getBalance(addresses.scheduler)) / 10n ** 10n;
    if (amountTinybar === 0n) return;
    const tx = await scheduler.withdrawExcess(owner.address, amountTinybar);
    await tx.wait();
    console.log("Refunded canary HBAR:", ethers.formatUnits(amountTinybar, 8), "tx:", tx.hash);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
