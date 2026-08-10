import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    const depPath = path.join(__dirname, "../../deployments/testnet.json");
    const dep = JSON.parse(fs.readFileSync(depPath, "utf-8"));

    const [deployer] = await ethers.getSigners();
    const adapter = await ethers.getContractAt("PythOracleAdapter", dep["PythOracleAdapter"]);
    
    // The keeper address from KEEPER_PRIVATE_KEY
    const keeperAddress = "0x60afe82500e6ed0b9f6158bf74bbe0b3946739e0";
    console.log("Setting keeper to", keeperAddress);
    
    await (await adapter.setKeeper(keeperAddress)).wait();
    console.log("Keeper set successfully!");
}
main().catch(console.error);
