import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Provide Stability flow. Account:", deployer.address);

    const depPath = path.join(__dirname, "../../deployments/testnet.json");
    const dep = JSON.parse(fs.readFileSync(depPath, "utf-8"));

    const sp = await ethers.getContractAt("StabilityPool", dep["StabilityPool"]);
    const usdc = await ethers.getContractAt("IERC20", dep["wUSDC"]);
    
    // Provide 100 wUSDC
    const depositAmt = ethers.parseUnits("100", 8);

    console.log("Approve StabilityPool...");
    await (await usdc.approve(dep["StabilityPool"], depositAmt)).wait();

    console.log("Deposit wUSDC to StabilityPool...");
    await (await sp.deposit(dep["wUSDC"], depositAmt)).wait();
    
    console.log("StabilityPool deposit success.");
}
main().catch(console.error);
