import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Setup flow. Account:", deployer.address);

    const depPath = path.join(__dirname, "../../deployments/testnet.json");
    if (!fs.existsSync(depPath)) throw new Error("testnet.json missing");
    const dep = JSON.parse(fs.readFileSync(depPath, "utf-8"));

    const factory = await ethers.getContractAt("WrappedTokenFactory", dep["WrappedTokenFactory"]);
    const oracle = await ethers.getContractAt("PythOracleAdapter", dep["PythOracleAdapter"]);
    
    const wUSDC = dep["wUSDC"];
    const wETH = dep["wETH"];

    // 1. Oracle Setup
    console.log("Check oracle...");
    const ethFeed = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
    const usdcFeed = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";

    const wBTC = dep["wBTC"];
    const btcFeed = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

    if (await oracle.priceFeeds(wETH) === ethers.ZeroHash) {
        console.log("Register wETH feed...");
        await (await oracle.registerPriceFeed(wETH, ethFeed)).wait();
    }
    if (await oracle.priceFeeds(wUSDC) === ethers.ZeroHash) {
        console.log("Register wUSDC feed...");
        await (await oracle.registerPriceFeed(wUSDC, usdcFeed)).wait();
    }
    if (wBTC && (await oracle.priceFeeds(wBTC) === ethers.ZeroHash)) {
        console.log("Register wBTC feed...");
        await (await oracle.registerPriceFeed(wBTC, btcFeed)).wait();
    }

    const thresh = await oracle.stalenessThreshold();
    if (thresh < 86400n * 365n) {
        console.log("Increase oracle staleness...");
        await (await oracle.setStalenessThreshold(86400 * 365)).wait();
    }

    // 2. Fund Scheduler
    console.log("Fund SchedulerEngine (10 HBAR)...");
    await (await deployer.sendTransaction({ to: dep["SchedulerEngine"], value: ethers.parseEther("10") })).wait();

    // 3. Mint tokens
    console.log("Mint test tokens...");
    try {
        await (await factory.transferTokens(wUSDC, deployer.address, ethers.parseUnits("1000", 8))).wait();
        await (await factory.transferTokens(wETH, deployer.address, ethers.parseUnits("1", 8))).wait();
        console.log("Tokens minted.");
    } catch (e: any) {
        console.log("Mint failed (maybe already minted or no association).", e.message);
    }
}
main().catch(console.error);
