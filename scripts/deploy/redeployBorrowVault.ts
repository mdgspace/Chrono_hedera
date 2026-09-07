import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const deploymentsPath = path.resolve(__dirname, "../../deployments/testnet.json");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Starting BorrowVault redeployment with account:", deployer.address);

    if (!fs.existsSync(deploymentsPath)) {
        throw new Error(`Deployments file not found at ${deploymentsPath}`);
    }

    const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
    const oldBorrowVault = deployments["BorrowVault"];
    console.log("Current BorrowVault:", oldBorrowVault);

    // 1. Deploy new BorrowVault
    console.log("\n1. Deploying new BorrowVault...");
    const BorrowVaultFactory = await ethers.getContractFactory("BorrowVault");
    const newBorrowVault = await BorrowVaultFactory.deploy();
    await newBorrowVault.waitForDeployment();
    const newBorrowVaultAddress = await newBorrowVault.getAddress();
    console.log("New BorrowVault deployed at:", newBorrowVaultAddress);

    // 2. Initialize new BorrowVault
    console.log("\n2. Initializing new BorrowVault...");
    const initTx = await newBorrowVault.initialize(
        deployments["AssetRegistry"],
        deployments["RiskEngine"],
        deployments["PythOracleAdapter"],
        deployments["LendingPool"],
        deployments["InterestEngine"],
        deployments["SchedulerEngine"],
        deployments["LiquidationEngine"]
    );
    await initTx.wait();
    console.log("New BorrowVault initialized.");

    // 3. Update Authorizations on LendingPool & InterestEngine
    console.log("\n3. Updating LendingPool authorizations...");
    const lendingPool = await ethers.getContractAt("LendingPool", deployments["LendingPool"]);
    const lpAuthTx = await lendingPool.setAuthorized(newBorrowVaultAddress, true);
    await lpAuthTx.wait();
    if (oldBorrowVault) {
        try {
            await (await lendingPool.setAuthorized(oldBorrowVault, false)).wait();
            console.log("Old BorrowVault de-authorized from LendingPool.");
        } catch (e) {
            console.warn("Could not de-authorize old vault from LendingPool:", (e as Error).message);
        }
    }

    console.log("\n4. Updating InterestEngine authorizations...");
    const interestEngine = await ethers.getContractAt("InterestEngine", deployments["InterestEngine"]);
    const ieAuthTx = await interestEngine.setAuthorized(newBorrowVaultAddress, true);
    await ieAuthTx.wait();
    if (oldBorrowVault) {
        try {
            await (await interestEngine.setAuthorized(oldBorrowVault, false)).wait();
            console.log("Old BorrowVault de-authorized from InterestEngine.");
        } catch (e) {
            console.warn("Could not de-authorize old vault from InterestEngine:", (e as Error).message);
        }
    }

    // 5. Re-initialize LiquidationEngine with new BorrowVault
    console.log("\n5. Updating LiquidationEngine wiring...");
    const liquidationEngine = await ethers.getContractAt("LiquidationEngine", deployments["LiquidationEngine"]);
    const liqInitTx = await liquidationEngine.initialize(
        deployments["PythOracleAdapter"],
        deployments["AssetRegistry"],
        deployments["InterestEngine"],
        deployments["RiskEngine"],
        deployments["StabilityPool"],
        newBorrowVaultAddress,
        deployments["LendingPool"]
    );
    await liqInitTx.wait();
    console.log("LiquidationEngine re-initialized with new BorrowVault.");

    // 6. Re-initialize SchedulerEngine with new BorrowVault
    console.log("\n6. Updating SchedulerEngine wiring...");
    const schedulerEngine = await ethers.getContractAt("SchedulerEngine", deployments["SchedulerEngine"]);
    const schedInitTx = await schedulerEngine.initialize(
        deployments["LiquidationEngine"],
        newBorrowVaultAddress
    );
    await schedInitTx.wait();
    console.log("SchedulerEngine re-initialized with new BorrowVault.");

    // 7. Re-initialize ChronoRouter with new BorrowVault
    console.log("\n7. Updating ChronoRouter wiring...");
    const chronoRouter = await ethers.getContractAt("ChronoRouter", deployments["ChronoRouter"]);
    const routerInitTx = await chronoRouter.initialize(
        deployments["PythOracleAdapter"],
        newBorrowVaultAddress,
        deployments["LendingPool"]
    );
    await routerInitTx.wait();
    console.log("ChronoRouter re-initialized with new BorrowVault.");

    // 8. Auto-associate HTS Tokens (wETH, wUSDC, wBTC)
    console.log("\n8. Associating HTS tokens to new BorrowVault...");
    const tokens = [deployments["wUSDC"], deployments["wETH"], deployments["wBTC"]].filter(Boolean);
    for (const tokenAddr of tokens) {
        try {
            const token = await ethers.getContractAt("IERC20", tokenAddr);
            const tx = await token.transfer(newBorrowVaultAddress, 1);
            await tx.wait();
            console.log(`Associated token ${tokenAddr} to new BorrowVault.`);
        } catch (e) {
            console.warn(`Token association for ${tokenAddr} note:`, (e as Error).message);
        }
    }

    // 9. Persist new BorrowVault in deployments/testnet.json
    deployments["BorrowVault"] = newBorrowVaultAddress;
    fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
    console.log("\nUpdated deployments/testnet.json successfully!");
    console.log("Redeployment and wiring complete.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
