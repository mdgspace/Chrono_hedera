import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("--- Inspect Flow ---");
    console.log("Account:", deployer.address);

    const depPath = path.join(__dirname, "../../deployments/testnet.json");
    const dep = JSON.parse(fs.readFileSync(depPath, "utf-8"));
    
    const usdc = await ethers.getContractAt("IERC20", dep["wUSDC"]);
    const eth = await ethers.getContractAt("IERC20", dep["wETH"]);
    const vault = await ethers.getContractAt("BorrowVault", dep["BorrowVault"]);
    const pool = await ethers.getContractAt("LendingPool", dep["LendingPool"]);
    const sp = await ethers.getContractAt("StabilityPool", dep["StabilityPool"]);

    // Wallet Balances
    console.log("\n== Wallet Balances ==");
    console.log(`wUSDC: ${ethers.formatUnits(await usdc.balanceOf(deployer.address), 8)}`);
    console.log(`wETH: ${ethers.formatUnits(await eth.balanceOf(deployer.address), 8)}`);

    // Pool Deposits
    console.log("\n== Lending Pool Deposits ==");
    console.log(`wUSDC Shares: ${ethers.formatUnits(await pool.userShares(deployer.address, dep["wUSDC"]), 8)}`);

    console.log("\n== Stability Pool Deposits ==");
    let scale = await sp.depositScale(dep["wUSDC"]);
    if (scale === 0n) scale = 1000000000000000000n; // 1e18 WAD
    const scaledDep = await sp.providerScaledDeposits(dep["wUSDC"], deployer.address);
    const spUsdc = (scaledDep * scale) / 1000000000000000000n;
    console.log(`wUSDC in Stability Pool: ${ethers.formatUnits(spUsdc, 8)}`);

    // Borrow Position
    const nextPosId = await vault.nextPositionId();
    let foundPositions = 0;
    
    for (let i = 1n; i < nextPosId; i++) {
        const posId = ethers.zeroPadValue(ethers.toBeHex(i), 32);
        try {
            const pos = await vault.getPosition(posId);
            if (pos.borrower.toLowerCase() === deployer.address.toLowerCase()) {
                foundPositions++;
                console.log(`\n== Position details (${posId}) ==`);
                console.log(`Active: ${pos.active}`);
                console.log(`Collateral in Escrow (Vault): ${ethers.formatUnits(pos.collateralAmount, 8)} wETH`);
                console.log(`Debt Owed: ${ethers.formatUnits(pos.borrowAmount, 8)} wUSDC`);
            }
        } catch (e: any) {
            // Ignore missing positions or errors
        }
    }
    
    if (foundPositions === 0) {
        console.log("\nNo positions found for this account.");
    }
}
main().catch(console.error);
