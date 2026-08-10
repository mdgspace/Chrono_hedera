import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    const depPath = path.join(__dirname, "../../deployments/testnet.json");
    const dep = JSON.parse(fs.readFileSync(depPath, "utf-8"));
    const statePath = path.join(__dirname, "../../deployments/testnet-state.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    const posId = state.lastPositionId;

    const vault = await ethers.getContractAt("BorrowVault", dep["BorrowVault"]);
    const oracle = await ethers.getContractAt("PythOracleAdapter", dep["PythOracleAdapter"]);
    const liqEngine = await ethers.getContractAt("LiquidationEngine", dep["LiquidationEngine"]);

    console.log(`Debugging position ${posId}...`);
    const pos = await vault.getPosition(posId);
    console.log("Active:", pos.active);
    
    const block = await ethers.provider.getBlock("latest");
    console.log("Current block timestamp:", block?.timestamp);
    console.log("Pos Start Time:", pos.startTime);
    console.log("Pos Duration:", pos.duration);
    console.log("Expired?:", Number(block?.timestamp) >= Number(pos.startTime) + Number(pos.duration));

    try {
        const pETH = await oracle.getPrice(dep["wETH"]);
        console.log("Oracle wETH price:", pETH.toString());
    } catch (e: any) {
        console.error("Oracle wETH failed:", e.message);
    }
    
    try {
        const pUSDC = await oracle.getPrice(dep["wUSDC"]);
        console.log("Oracle wUSDC price:", pUSDC.toString());
    } catch (e: any) {
        console.error("Oracle wUSDC failed:", e.message);
    }

    console.log("Calling static executeHardLiquidation...");
    try {
        await liqEngine.executeHardLiquidation.staticCall(posId);
        console.log("Static call succeeded! Revert is gone.");
    } catch (e: any) {
        console.error("Static call reverted:", e.message);
    }
}
main().catch(console.error);
