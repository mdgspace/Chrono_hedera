import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    const deployments: Record<string, string> = {};

    // Helper to save deployments
    const saveDeployments = () => {
        const dir = path.join(__dirname, "../../deployments");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            path.join(dir, "testnet.json"),
            JSON.stringify(deployments, null, 2)
        );
    };

    // Step 1: Deploy Token Factory and Create 3 tokens
    console.log("Step 1: Deploying Token Factory...");
    const Factory = await ethers.getContractFactory("WrappedTokenFactory");
    const factory = await Factory.deploy();
    await factory.waitForDeployment();
    const factoryAddress = await factory.getAddress();
    deployments["WrappedTokenFactory"] = factoryAddress;
    console.log("WrappedTokenFactory deployed to:", factoryAddress);

    const tokensToCreate = [
        { name: "Wrapped USDC", symbol: "wUSDC", decimals: 8, supply: 1000000n * 10n ** 8n },
        { name: "Wrapped ETH", symbol: "wETH", decimals: 8, supply: 1000n * 10n ** 8n },
        { name: "Wrapped BTC", symbol: "wBTC", decimals: 8, supply: 100n * 10n ** 8n }
    ];

    const tokenAddresses: Record<string, string> = {};
    for (const t of tokensToCreate) {
        // HBAR fee for token creation is required on actual testnet (e.g., 20 HBAR)
        const fee = ethers.parseEther("20"); 
        
        try {
            console.log(`Creating ${t.symbol}...`);
            const tx = await factory.createWrappedToken(t.name, t.symbol, t.decimals, t.supply, { value: fee });
            const receipt = await tx.wait();
            
            // Extract token address from event
            const event = receipt?.logs.find((l: any) => l.fragment?.name === "TokenCreated") as any;
            if (event) {
                tokenAddresses[t.symbol] = event.args.tokenAddress;
                deployments[t.symbol] = event.args.tokenAddress;
                console.log(`${t.symbol} created at:`, event.args.tokenAddress);
            }
        } catch (e) {
            console.warn(`Skipping actual HTS token creation for ${t.symbol} on local node / dry-run`);
            tokenAddresses[t.symbol] = ethers.ZeroAddress; 
        }
    }

    // Step 2: Deploy Oracle Adapter
    console.log("Step 2: Deploying Oracle Adapter...");
    // Note: Use actual Pyth contract address on Hedera testnet
    const PYTH_ADDRESS = "0x2880aB155794e7179c9eE2e38200202908C17B43"; // Placeholder
    const Oracle = await ethers.getContractFactory("PythOracleAdapter");
    const oracle = await Oracle.deploy(PYTH_ADDRESS);
    await oracle.waitForDeployment();
    const oracleAddress = await oracle.getAddress();
    deployments["PythOracleAdapter"] = oracleAddress;
    console.log("PythOracleAdapter deployed to:", oracleAddress);

    // Step 3: Deploy Core Contracts
    console.log("Step 3: Deploying Core Contracts...");
    
    const AssetReg = await ethers.getContractFactory("AssetRegistry");
    const assetRegistry = await AssetReg.deploy(deployer.address);
    await assetRegistry.waitForDeployment();
    deployments["AssetRegistry"] = await assetRegistry.getAddress();
    console.log("AssetRegistry:", deployments["AssetRegistry"]);

    const LendingPool = await ethers.getContractFactory("LendingPool");
    const lendingPool = await LendingPool.deploy(deployments["AssetRegistry"], deployer.address);
    await lendingPool.waitForDeployment();
    deployments["LendingPool"] = await lendingPool.getAddress();
    console.log("LendingPool:", deployments["LendingPool"]);

    const InterestEngine = await ethers.getContractFactory("InterestEngine");
    const interestEngine = await InterestEngine.deploy(
        deployments["LendingPool"],
        deployments["AssetRegistry"],
        deployer.address
    );
    await interestEngine.waitForDeployment();
    deployments["InterestEngine"] = await interestEngine.getAddress();
    console.log("InterestEngine:", deployments["InterestEngine"]);

    const RiskEngine = await ethers.getContractFactory("RiskEngine");
    const riskEngine = await RiskEngine.deploy(deployments["AssetRegistry"]);
    await riskEngine.waitForDeployment();
    deployments["RiskEngine"] = await riskEngine.getAddress();
    console.log("RiskEngine:", deployments["RiskEngine"]);

    const StabilityPool = await ethers.getContractFactory("StabilityPool");
    const stabilityPool = await StabilityPool.deploy();
    await stabilityPool.waitForDeployment();
    deployments["StabilityPool"] = await stabilityPool.getAddress();
    console.log("StabilityPool:", deployments["StabilityPool"]);

    const SchedulerEngine = await ethers.getContractFactory("SchedulerEngine");
    const schedulerEngine = await SchedulerEngine.deploy();
    await schedulerEngine.waitForDeployment();
    deployments["SchedulerEngine"] = await schedulerEngine.getAddress();
    console.log("SchedulerEngine:", deployments["SchedulerEngine"]);

    const LiquidationEngine = await ethers.getContractFactory("LiquidationEngine");
    const liquidationEngine = await LiquidationEngine.deploy();
    await liquidationEngine.waitForDeployment();
    deployments["LiquidationEngine"] = await liquidationEngine.getAddress();
    console.log("LiquidationEngine:", deployments["LiquidationEngine"]);

    const BorrowVault = await ethers.getContractFactory("BorrowVault");
    const borrowVault = await BorrowVault.deploy();
    await borrowVault.waitForDeployment();
    deployments["BorrowVault"] = await borrowVault.getAddress();
    console.log("BorrowVault:", deployments["BorrowVault"]);

    const ChronoRouter = await ethers.getContractFactory("ChronoRouter");
    const chronoRouter = await ChronoRouter.deploy();
    await chronoRouter.waitForDeployment();
    deployments["ChronoRouter"] = await chronoRouter.getAddress();
    console.log("ChronoRouter:", deployments["ChronoRouter"]);

    saveDeployments();

    // Step 4: Wire Authorizations & Initializes
    console.log("Step 4: Wiring Authorizations...");
    await lendingPool.setAuthorized(deployments["BorrowVault"], true);
    await lendingPool.setAuthorized(deployments["LiquidationEngine"], true);

    await interestEngine.setAuthorized(deployments["BorrowVault"], true);
    await interestEngine.setAuthorized(deployments["LiquidationEngine"], true);

    await stabilityPool.setLiquidationEngine(deployments["LiquidationEngine"]);

    await schedulerEngine.initialize(deployments["LiquidationEngine"], deployments["BorrowVault"]);

    await liquidationEngine.initialize(
        deployments["PythOracleAdapter"],
        deployments["AssetRegistry"],
        deployments["InterestEngine"],
        deployments["RiskEngine"],
        deployments["StabilityPool"],
        deployments["BorrowVault"],
        deployments["LendingPool"]
    );

    await borrowVault.initialize(
        deployments["AssetRegistry"],
        deployments["RiskEngine"],
        deployments["PythOracleAdapter"],
        deployments["LendingPool"],
        deployments["InterestEngine"],
        deployments["SchedulerEngine"],
        deployments["LiquidationEngine"]
    );

    await chronoRouter.initialize(
        deployments["PythOracleAdapter"],
        deployments["BorrowVault"],
        deployments["LendingPool"]
    );

    // Step 4.5 (Phase 15): Token Associations
    // Helper to safely call associateToken if implemented
    const associateTokens = async (contract: any) => {
        if (contract.associateToken) {
            for (const t of Object.values(tokenAddresses)) {
                if (t !== ethers.ZeroAddress) {
                    try { await contract.associateToken(t); } catch (e) {}
                }
            }
        }
    };

    console.log("Step 4.5: Associating Tokens...");
    await associateTokens(lendingPool);
    await associateTokens(borrowVault);
    await associateTokens(stabilityPool);
    await associateTokens(liquidationEngine);
    await associateTokens(chronoRouter);

    // Step 5: Register Assets
    console.log("Step 5: Registering Assets...");
    // wUSDC config
    if (tokenAddresses["wUSDC"] !== ethers.ZeroAddress) {
        await assetRegistry.registerAsset({
            tokenAddress: tokenAddresses["wUSDC"],
            decimals: 8,
            isStablecoin: true,
            ltvBase: ethers.parseUnits("0.8", 18),
            ltvMax: ethers.parseUnits("0.97", 18),
            kDecay: 7614000000000n, // ln(2)/(1 day)
            liquidationBonus: ethers.parseUnits("0.03", 18), // 3%
            closeFactor: ethers.parseUnits("0.5", 18),
            ltBufferMin: ethers.parseUnits("0.05", 18),
            ltBufferMax: ethers.parseUnits("0.25", 18),
            kLtBuffer: 7614000000000n,
            hardLiqPenalty: ethers.parseUnits("0.05", 18), // 5%
            minBorrowDuration: 3600,
            maxBorrowDuration: 2592000, // 30 days
            isActive: true
        });
    }

    // wETH config
    if (tokenAddresses["wETH"] !== ethers.ZeroAddress) {
        await assetRegistry.registerAsset({
            tokenAddress: tokenAddresses["wETH"],
            decimals: 8,
            isStablecoin: false,
            ltvBase: ethers.parseUnits("0.6", 18),
            ltvMax: ethers.parseUnits("0.85", 18),
            kDecay: 7614000000000n,
            liquidationBonus: ethers.parseUnits("0.05", 18),
            closeFactor: ethers.parseUnits("0.5", 18),
            ltBufferMin: ethers.parseUnits("0.05", 18),
            ltBufferMax: ethers.parseUnits("0.25", 18),
            kLtBuffer: 7614000000000n,
            hardLiqPenalty: ethers.parseUnits("0.1", 18),
            minBorrowDuration: 3600,
            maxBorrowDuration: 2592000,
            isActive: true
        });
    }

    // wBTC config
    if (tokenAddresses["wBTC"] !== ethers.ZeroAddress) {
        await assetRegistry.registerAsset({
            tokenAddress: tokenAddresses["wBTC"],
            decimals: 8,
            isStablecoin: false,
            ltvBase: ethers.parseUnits("0.5", 18),
            ltvMax: ethers.parseUnits("0.8", 18),
            kDecay: 7614000000000n,
            liquidationBonus: ethers.parseUnits("0.06", 18),
            closeFactor: ethers.parseUnits("0.5", 18),
            ltBufferMin: ethers.parseUnits("0.05", 18),
            ltBufferMax: ethers.parseUnits("0.25", 18),
            kLtBuffer: 7614000000000n,
            hardLiqPenalty: ethers.parseUnits("0.1", 18),
            minBorrowDuration: 3600,
            maxBorrowDuration: 2592000,
            isActive: true
        });
    }

    console.log("Deployment Complete!");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
