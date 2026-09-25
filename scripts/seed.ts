import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

// Multi-token seed config: token symbol -> human deposit amount
const DEFAULT_SEEDS: Record<string, string> = {
    wUSDC: "500",
    wETH: "0.2"
};

async function main() {
    const [deployer] = await ethers.getSigners();
    const depPath = path.join(__dirname, "../deployments/testnet.json");
    const dep = JSON.parse(fs.readFileSync(depPath, "utf-8"));
    const sp = await ethers.getContractAt("StabilityPool", dep["StabilityPool"]);
    const factory = await ethers.getContractAt("WrappedTokenFactory", dep["WrappedTokenFactory"]);

    // Support optional CLI/env override: SEED_TOKENS="wUSDC:1000,wETH:1"
    const seedInput = process.env.SEED_TOKENS
        ? Object.fromEntries(process.env.SEED_TOKENS.split(",").map(p => p.split(":") as [string, string]))
        : DEFAULT_SEEDS;

    for (const [symbol, amountStr] of Object.entries(seedInput)) {
        const tokenAddr = dep[symbol];
        if (!tokenAddr) {
            console.warn(`Token ${symbol} not in deployments, skipping.`);
            continue;
        }

        const token = await ethers.getContractAt("IERC20", tokenAddr);
        const amount = ethers.parseUnits(amountStr, 8);

        // Auto-mint from factory treasury if deployer balance is low
        const bal = await token.balanceOf(deployer.address);
        if (bal < amount) {
            const needed = amount - bal + ethers.parseUnits("100", 8);
            console.log(`Deployer balance low for ${symbol} (${ethers.formatUnits(bal, 8)}). Minting ${ethers.formatUnits(needed, 8)} from factory...`);
            await (await factory.transferTokens(tokenAddr, deployer.address, needed)).wait();
        }

        console.log(`Seeding StabilityPool with ${amountStr} ${symbol}...`);
        await (await token.approve(dep["StabilityPool"], amount)).wait();
        await (await sp.deposit(tokenAddr, amount)).wait();

        const canAbsorb = await sp.canAbsorb(tokenAddr, amount / 2n);
        console.log(`✓ ${symbol} seeded. canAbsorb: ${canAbsorb}`);
    }
}

main().catch(console.error);
