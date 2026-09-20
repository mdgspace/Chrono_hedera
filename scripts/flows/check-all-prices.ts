import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    const depPath = path.join(__dirname, "../../deployments/testnet.json");
    const dep = JSON.parse(fs.readFileSync(depPath, "utf-8"));

    const oracle = await ethers.getContractAt("PythOracleAdapter", dep["PythOracleAdapter"]);
    const tokens = {
        "wUSDC": dep["wUSDC"],
        "wETH": dep["wETH"],
        "wBTC": dep["wBTC"]
    };

    console.log("Checking oracle prices for all assets...");
    for (const [name, addr] of Object.entries(tokens)) {
        try {
            const feed = await oracle.priceFeeds(addr);
            console.log(`\n${name} (${addr}):`);
            console.log(`  Feed ID: ${feed}`);
            const price = await oracle.getPrice(addr);
            console.log(`  Price (WAD): ${price.toString()} ($${ethers.formatUnits(price, 18)})`);
        } catch (e: any) {
            console.warn(`  Error fetching ${name} price: ${e.message}`);
        }
    }
}

main().catch(console.error);
