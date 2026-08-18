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
    
    for (const token of tokens) {
        const tokenAddress = deployments[token];
        if (!tokenAddress || tokenAddress === ethers.ZeroAddress) continue;
        
        console.log(`Updating ${token} at ${tokenAddress}...`);
        
        try {
            // First get existing config
            const config = await assetRegistry.getConfig(tokenAddress);
            
            // Create a new config object by overriding minBorrowDuration
            const newConfig = {
                tokenAddress: tokenAddress,
                decimals: config.decimals,
                isStablecoin: config.isStablecoin,
                ltvBase: config.ltvBase,
                ltvMax: config.ltvMax,
                kDecay: config.kDecay,
                liquidationBonus: config.liquidationBonus,
                closeFactor: config.closeFactor,
                ltBufferMin: config.ltBufferMin,
                ltBufferMax: config.ltBufferMax,
                kLtBuffer: config.kLtBuffer,
                hardLiqPenalty: config.hardLiqPenalty,
                minBorrowDuration: 60, // 1 minute
                maxBorrowDuration: config.maxBorrowDuration,
                isActive: config.isActive
            };
            
            const tx = await assetRegistry.updateAssetConfig(tokenAddress, newConfig);
            await tx.wait();
            console.log(`Successfully updated ${token} to 1 min minBorrowDuration!`);
        } catch (e: any) {
            console.error(`Failed to update ${token}: ${e.message}`);
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
