import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Lend flow. Account:", deployer.address);

    const depPath = path.join(__dirname, "../../deployments/testnet.json");
    const dep = JSON.parse(fs.readFileSync(depPath, "utf-8"));

    const router = await ethers.getContractAt("ChronoRouter", dep["ChronoRouter"]);
    const usdc = await ethers.getContractAt("IERC20", dep["wUSDC"]);
    
    const depositAmt = ethers.parseUnits("500", 8);

    console.log("Approve router...");
    await (await usdc.approve(dep["ChronoRouter"], depositAmt)).wait();

    console.log("Deposit wUSDC...");
    await (await router.deposit(dep["wUSDC"], depositAmt)).wait();
    
    console.log("Deposit success.");
}
main().catch(console.error);
