import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Repay flow. Account:", deployer.address);

    const depPath = path.join(__dirname, "../../deployments/testnet.json");
    const dep = JSON.parse(fs.readFileSync(depPath, "utf-8"));
    
    const statePath = path.join(__dirname, "../../deployments/testnet-state.json");
    if (!fs.existsSync(statePath)) throw new Error("testnet-state.json missing. Run borrow first.");
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    const posId = state.lastPositionId;
    if (!posId) throw new Error("No position ID in state.");

    const router = await ethers.getContractAt("ChronoRouter", dep["ChronoRouter"]);
    const usdc = await ethers.getContractAt("IERC20", dep["wUSDC"]);
    
    const repayAmt = ethers.parseUnits("50", 8);

    console.log("Approve router for wUSDC...");
    await (await usdc.approve(dep["ChronoRouter"], repayAmt)).wait();

    console.log(`Repay position ${posId}...`);
    await (await router.repay(posId, repayAmt)).wait();
    
    console.log("Repay success.");
}
main().catch(console.error);
