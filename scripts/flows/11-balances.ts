import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    const depPath = path.join(__dirname, "../../deployments/testnet.json");
    const dep = JSON.parse(fs.readFileSync(depPath, "utf-8"));

    const wETH = await ethers.getContractAt("IERC20", dep["wETH"]);
    const wUSDC = await ethers.getContractAt("IERC20", dep["wUSDC"]);

    const contracts = {
        "LiquidationEngine": dep["LiquidationEngine"],
        "StabilityPool": dep["StabilityPool"],
        "LendingPool": dep["LendingPool"],
        "BorrowVault": dep["BorrowVault"],
        "Deployer": (await ethers.getSigners())[0].address
    };

    console.log("== Balances ==");
    for (const [name, addr] of Object.entries(contracts)) {
        const ethBal = await wETH.balanceOf(addr);
        const usdcBal = await wUSDC.balanceOf(addr);
        console.log(`${name}:`);
        console.log(`  wETH:  ${ethBal.toString()}`);
        console.log(`  wUSDC: ${usdcBal.toString()}`);
    }
}
main().catch(console.error);
