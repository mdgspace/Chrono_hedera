import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Lend flow for WETH. Account:", deployer.address);

    const depPath = path.join(__dirname, "../../deployments/testnet.json");
    const dep = JSON.parse(fs.readFileSync(depPath, "utf-8"));

    const router = await ethers.getContractAt("ChronoRouter", dep["ChronoRouter"]);
    const weth = await ethers.getContractAt("IERC20", dep["wETH"]);
    
    // Check deployer balance first
    const bal = await weth.balanceOf(deployer.address);
    console.log("Deployer wETH balance:", ethers.formatUnits(bal, 8));

    const depositAmt = ethers.parseUnits("0.5", 8);

    console.log("Approve router...");
    await (await weth.approve(dep["ChronoRouter"], depositAmt, {gasLimit: 1000000})).wait();

    console.log("Deposit wETH...");
    await (await router.deposit(dep["wETH"], depositAmt, {gasLimit: 2000000})).wait();
    
    console.log("Deposit success.");
}
main().catch(console.error);
