import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Borrow flow. Account:", deployer.address);

    const depPath = path.join(__dirname, "../../deployments/testnet.json");
    const dep = JSON.parse(fs.readFileSync(depPath, "utf-8"));

    const router = await ethers.getContractAt("ChronoRouter", dep["ChronoRouter"]);
    const vault = await ethers.getContractAt("BorrowVault", dep["BorrowVault"]);
    const eth = await ethers.getContractAt("IERC20", dep["wETH"]);
    
    const collAmt = ethers.parseUnits("0.1", 8);
    const borrowAmt = ethers.parseUnits("100", 8);
    const duration = 86400 * 7;

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
    console.log("Position ID:", posId);

    // Save state for repay script
    const statePath = path.join(__dirname, "../../deployments/testnet-state.json");
    let state: any = {};
    if (fs.existsSync(statePath)) state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    state.lastPositionId = posId;
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}
main().catch(console.error);
