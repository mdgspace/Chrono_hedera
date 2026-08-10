import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Manual Hard Liquidate flow. Account:", deployer.address);

    const depPath = path.join(__dirname, "../../deployments/testnet.json");
    const dep = JSON.parse(fs.readFileSync(depPath, "utf-8"));

    const statePath = path.join(__dirname, "../../deployments/testnet-state.json");
    if (!fs.existsSync(statePath)) throw new Error("No state found");
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    const posId = state.lastPositionId;
    if (!posId) throw new Error("No position ID");

    const liqEngine = await ethers.getContractAt("LiquidationEngine", dep["LiquidationEngine"]);
    const oracle = await ethers.getContractAt("PythOracleAdapter", dep["PythOracleAdapter"]);
    
    const ethFeed = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
    const usdcFeed = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";
    
    // Fetch latest price update payloads
    console.log("Fetch Pyth VAA from Hermes API...");
    const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${ethFeed.replace("0x", "")}&ids[]=${usdcFeed.replace("0x", "")}`;
    const resp = await fetch(url);
    const data = await resp.json();
    const updateData = data.binary.data.map((hex: string) => "0x" + hex);

    console.log("Updating oracle...");
    const fee = ethers.parseEther("0.1");
    await (await oracle.updatePrice(dep["wETH"], updateData, { value: fee })).wait();

    console.log(`Executing hard liquidation for position ${posId}...`);
    try {
        const tx = await liqEngine.executeHardLiquidation(posId);
        await tx.wait();
        console.log("Hard liquidation successful!");
    } catch (e: any) {
        console.log("Failed to liquidate:", e.message);
    }
}
main().catch(console.error);
