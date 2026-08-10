import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Short Borrow flow (1.1 hours). Account:", deployer.address);

    const depPath = path.join(__dirname, "../../deployments/testnet.json");
    const dep = JSON.parse(fs.readFileSync(depPath, "utf-8"));

    const router = await ethers.getContractAt("ChronoRouter", dep["ChronoRouter"]);
    const vault = await ethers.getContractAt("BorrowVault", dep["BorrowVault"]);
    const registry = await ethers.getContractAt("AssetRegistry", dep["AssetRegistry"]);
    const eth = await ethers.getContractAt("IERC20", dep["wETH"]);
    
    const collAmt = ethers.parseUnits("0.1", 8);
    const borrowAmt = ethers.parseUnits("10", 8); // borrowing 10 wUSDC
    const duration = 60; // 1 minute

    console.log("Lowering minBorrowDuration to 60s for test...");
    let config = await registry.getConfig(dep["wETH"]);
    // Hardhat ethers returns a struct as an array/object, we have to pass it as an object or tuple.
    // Easiest is to construct the object:
    const newConfig = {
        tokenAddress: config.tokenAddress,
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
        minBorrowDuration: 60,
        maxBorrowDuration: config.maxBorrowDuration,
        isActive: config.isActive
    };
    await (await registry.updateAssetConfig(dep["wETH"], newConfig)).wait();

    console.log("Approve router for wETH...");
    await (await eth.approve(dep["ChronoRouter"], collAmt)).wait();

    // Oracle is updated by background keeper script.
    console.log("Calling router...");
    const tx = await router.openPosition(dep["wETH"], dep["wUSDC"], collAmt, borrowAmt, duration);
    const rx = await tx.wait();

    // Parse position ID
    let posId = "";
    for (const log of rx!.logs) {
        try {
            const p = vault.interface.parseLog({ topics: log.topics as string[], data: log.data });
            if (p && p.name === "PositionOpened") { posId = p.args.positionId; break; }
        } catch(e) {}
    }

    if (!posId) throw new Error("No PositionOpened event.");
    console.log("Short Position ID:", posId);

    // Save state for inspect script
    const statePath = path.join(__dirname, "../../deployments/testnet-state.json");
    let state: any = {};
    if (fs.existsSync(statePath)) state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    state.lastPositionId = posId;
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}
main().catch(console.error);
