import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    const depPath = path.join(__dirname, "../../deployments/testnet.json");
    const dep = JSON.parse(fs.readFileSync(depPath, "utf-8"));

    const [deployer] = await ethers.getSigners();
    console.log("Registering wBTC feed with account:", deployer.address);

    const oracle = await ethers.getContractAt("PythOracleAdapter", dep["PythOracleAdapter"]);
    const wBTC = dep["wBTC"];
    const btcFeed = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

    const currentFeed = await oracle.priceFeeds(wBTC);
    console.log("Current wBTC feed:", currentFeed);

    if (currentFeed === ethers.ZeroHash) {
        console.log("Registering wBTC feed:", btcFeed);
        const tx = await oracle.registerPriceFeed(wBTC, btcFeed);
        await tx.wait();
        console.log("Successfully registered wBTC feed!");
    } else {
        console.log("wBTC feed is already registered.");
    }

    // Verify
    const updatedFeed = await oracle.priceFeeds(wBTC);
    console.log("Verified wBTC feed:", updatedFeed);
}

main().catch(console.error);
