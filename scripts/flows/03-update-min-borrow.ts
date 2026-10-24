import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    const deployPath = path.join(__dirname, "../../deployments/testnet.json");
    const deployments = JSON.parse(fs.readFileSync(deployPath, "utf-8"));
    
    const assetRegistryAddress = deployments["AssetRegistry"];
    const AssetRegistry = await ethers.getContractFactory("AssetRegistry");
    const assetRegistry = AssetRegistry.attach(assetRegistryAddress) as any;

    const [deployer] = await ethers.getSigners();
    console.log("Updating config with account:", deployer.address);

    const tokens = ["wUSDC", "wETH", "wBTC"];
    
    for (const collateral of tokens) {
        for (const debt of tokens) {
            if (collateral === debt) continue;
            const collateralAddress = deployments[collateral];
            const debtAddress = deployments[debt];
            if (!collateralAddress || !debtAddress) continue;
            try {
                const config = await assetRegistry.getPairConfig(collateralAddress, debtAddress);
                const tx = await assetRegistry.updatePairConfig(collateralAddress, debtAddress,
                    { ...config.toObject(), minBorrowDuration: 60 });
                await tx.wait();
                console.log(`Updated ${collateral}/${debt} to 1 min minimum duration`);
            } catch (e: any) {
                console.error(`Failed to update ${collateral}/${debt}: ${e.message}`);
            }
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
