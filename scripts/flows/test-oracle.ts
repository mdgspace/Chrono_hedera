import { ethers } from "hardhat";
import fs from "fs";

async function main() {
    const dep = JSON.parse(fs.readFileSync("deployments/testnet.json", "utf-8"));
    const oracle = await ethers.getContractAt("PythOracleAdapter", dep["PythOracleAdapter"]);
    
    // ETH feed ID
    const ethFeed = "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
    if (await oracle.priceFeeds(dep["wETH"]) !== ethFeed) {
        await (await oracle.registerPriceFeed(dep["wETH"], "0x" + ethFeed)).wait();
    }

    console.log("Fetching wETH payload from Hermes...");
    const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${ethFeed.replace("0x", "")}`;
    const resp = await fetch(url);
    const data = await resp.json();
    const updateData = data.binary.data.map((hex: string) => "0x" + hex);

    console.log("Updating Pyth contract on testnet...");
    const fee = ethers.parseEther("0.1");
    await (await oracle.updatePrice(dep["wETH"], updateData, { value: fee })).wait();

    console.log("Fetching wETH price from contract...");
    try {
        const p = await oracle.getPrice(dep["wETH"]);
        console.log("wETH price:", p.toString());
    } catch (e: any) {
        console.log("Error fetching wETH:", e.message);
    }

    
    console.log("Fetching wUSDC price...");
    try {
        const p = await oracle.getPrice(dep["wUSDC"]);
        console.log("wUSDC price:", p.toString());
    } catch (e: any) {
        console.log("Error fetching wUSDC:", e.message);
    }
}
main();
