import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    const depPath = path.join(__dirname, "../../deployments/testnet.json");
    const dep = JSON.parse(fs.readFileSync(depPath, "utf-8"));

    const liqEngine = await ethers.getContractAt("LiquidationEngine", dep["LiquidationEngine"]);
    
    // Read position ID from state
    const statePath = path.join(__dirname, "../../deployments/testnet-state.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    const posId = state.lastPositionId;

    console.log(`Manually executing hard liquidation for position ${posId}...`);
    try {
        const tx = await liqEngine.executeHardLiquidation(posId, { gasLimit: 3000000 });
        console.log("Tx hash:", tx.hash);
        await tx.wait();
        console.log("Hard liquidation successful!");
    } catch (e: any) {
        console.error("Hard liquidation failed:", e.message || e);
    }
}
main().catch(console.error);
