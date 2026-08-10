import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    const depPath = path.join(__dirname, "../../deployments/testnet.json");
    const dep = JSON.parse(fs.readFileSync(depPath, "utf-8"));

    const [deployer] = await ethers.getSigners();
    const wETH = await ethers.getContractAt("IERC20", dep["wETH"]);
    const wUSDC = await ethers.getContractAt("IERC20", dep["wUSDC"]);

    console.log("Associating everything...");
    const contracts = [
        dep["LiquidationEngine"],
        dep["StabilityPool"],
        dep["LendingPool"],
        dep["BorrowVault"],
        dep["ChronoRouter"]
    ];

    for (const c of contracts) {
        console.log(`Associating ${c}...`);
        try { await (await wETH.transfer(c, 1)).wait(); } catch (e: any) { console.log(`wETH error: ${e.message}`); }
        try { await (await wUSDC.transfer(c, 1)).wait(); } catch (e: any) { console.log(`wUSDC error: ${e.message}`); }
    }
    
    console.log("Associations complete!");
}
main().catch(console.error);
