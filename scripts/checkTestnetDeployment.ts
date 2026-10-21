import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    if (network.name !== "testnet") throw new Error("Use Hedera testnet");
    const deployments = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../deployments/testnet.json"), "utf8"));
    const [signer] = await ethers.getSigners();
    const chain = await ethers.provider.getNetwork();
    const balance = await ethers.provider.getBalance(signer.address);
    console.log("Network:", chain.chainId.toString());
    console.log("Deployer:", signer.address);
    console.log("Deployer HBAR:", ethers.formatEther(balance));

    for (const name of ["BorrowVault", "SchedulerEngine", "LiquidationEngine", "AssetRegistry", "MaturityCronScheduler", "ScheduleRecoveryQueue"]) {
        const address = deployments[name];
        if (!address) {
            console.log(name, "not in deployments/testnet.json");
            continue;
        }
        const code = await ethers.provider.getCode(address);
        console.log(name, address, code === "0x" ? "NO CODE" : "code present");
    }

    if (deployments.BorrowVault) {
        const vault = await ethers.getContractAt("BorrowVault", deployments.BorrowVault);
        console.log("Vault scheduler:", await vault.schedulerEngine());
        try {
            console.log("Vault maximum days:", Number(await vault.MAX_BORROW_DURATION()) / 86400);
        } catch {
            console.log("Vault maximum getter unavailable on recorded legacy deployment");
        }
    }
    if (deployments.AssetRegistry && deployments.wBTC) {
        const registry = await ethers.getContractAt("AssetRegistry", deployments.AssetRegistry);
        console.log("Registered assets:", await registry.getAllAssets());
        try {
            const btc = await registry.getConfig(deployments.wBTC);
            console.log("wBTC maximum days:", Number(btc.maxBorrowDuration) / 86400);
        } catch {
            console.log("wBTC config unavailable at recorded registry address");
        }
    }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
