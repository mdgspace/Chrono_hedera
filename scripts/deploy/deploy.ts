import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    const deploymentsPath = path.join(__dirname, "../../deployments/testnet.json");
    let existingDeployments: Record<string, string> = {};
    if (fs.existsSync(deploymentsPath)) {
        try {
            existingDeployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));
        } catch (e) {}
    }

    const deployments: Record<string, string> = { ...existingDeployments };

    // Helper to save deployments
    const saveDeployments = () => {
        const dir = path.join(__dirname, "../../deployments");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            deploymentsPath,
            JSON.stringify(deployments, null, 2)
        );
    };

    // Step 1: Deploy / Reuse Token Factory & Tokens
    let factory: any;
    if (existingDeployments["WrappedTokenFactory"]) {
        deployments["WrappedTokenFactory"] = existingDeployments["WrappedTokenFactory"];
        factory = await ethers.getContractAt("WrappedTokenFactory", deployments["WrappedTokenFactory"]);
        console.log("Reusing existing WrappedTokenFactory at:", deployments["WrappedTokenFactory"]);
    } else {
        console.log("Step 1: Deploying Token Factory...");
        const Factory = await ethers.getContractFactory("WrappedTokenFactory");
        factory = await Factory.deploy();
        await factory.waitForDeployment();
        const factoryAddress = await factory.getAddress();
        deployments["WrappedTokenFactory"] = factoryAddress;
        console.log("WrappedTokenFactory deployed to:", factoryAddress);
    }

    const tokensToCreate = [
        { name: "Wrapped USDC", symbol: "wUSDC", decimals: 8, supply: 1000000n * 10n ** 8n },
        { name: "Wrapped ETH", symbol: "wETH", decimals: 8, supply: 1000n * 10n ** 8n },
        { name: "Wrapped BTC", symbol: "wBTC", decimals: 8, supply: 100n * 10n ** 8n }
    ];

    const tokenAddresses: Record<string, string> = {};
    for (const t of tokensToCreate) {
        if (existingDeployments[t.symbol] && existingDeployments[t.symbol] !== ethers.ZeroAddress) {
            tokenAddresses[t.symbol] = existingDeployments[t.symbol];
            deployments[t.symbol] = existingDeployments[t.symbol];
            console.log(`Reusing existing ${t.symbol} at:`, existingDeployments[t.symbol]);
            continue;
        }

        const fee = ethers.parseEther("30"); 
        try {
            console.log(`Creating ${t.symbol}...`);
            const tx = await factory.createWrappedToken(t.name, t.symbol, t.decimals, t.supply, { value: fee });
            const receipt = await tx.wait();
            
            const event = receipt?.logs.find((l: any) => l.fragment?.name === "TokenCreated") as any;
            if (event) {
                tokenAddresses[t.symbol] = event.args.tokenAddress;
                deployments[t.symbol] = event.args.tokenAddress;
                console.log(`${t.symbol} created at:`, event.args.tokenAddress);
            }
        } catch (e: any) {
            console.warn(`Token creation failed for ${t.symbol}:`, e.message);
            tokenAddresses[t.symbol] = ethers.ZeroAddress; 
        }
    }

    // Step 2: Deploy / Reuse Oracle Adapter
    if (existingDeployments["PythOracleAdapter"]) {
        deployments["PythOracleAdapter"] = existingDeployments["PythOracleAdapter"];
        console.log("Reusing existing PythOracleAdapter at:", deployments["PythOracleAdapter"]);
    } else {
        console.log("Step 2: Deploying Oracle Adapter...");
        const OracleAdapter = await ethers.getContractFactory("PythOracleAdapter");
        const pythAddress = "0xA2aa501b19aff244D90cc15a4Cf739D2725B5729";
        const oracle = await OracleAdapter.deploy(pythAddress);
        await oracle.waitForDeployment();
        const oracleAddress = await oracle.getAddress();
        const setKeeperTx = await oracle.setKeeper(deployer.address);
        await setKeeperTx.wait();
        deployments["PythOracleAdapter"] = oracleAddress;
        console.log("PythOracleAdapter deployed to:", oracleAddress);
    }

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
    await (await lendingPool.setAuthorized(deployments["BorrowVault"], true)).wait();
    await (await lendingPool.setAuthorized(deployments["LiquidationEngine"], true)).wait();

    await (await interestEngine.setAuthorized(deployments["BorrowVault"], true)).wait();
    await (await interestEngine.setAuthorized(deployments["LiquidationEngine"], true)).wait();

    await (await stabilityPool.setLiquidationEngine(deployments["LiquidationEngine"])).wait();

    await (await schedulerEngine.initialize(deployments["LiquidationEngine"], deployments["BorrowVault"])).wait();

    await (await liquidationEngine.initialize(
        deployments["PythOracleAdapter"],
        deployments["AssetRegistry"],
        deployments["InterestEngine"],
        deployments["RiskEngine"],
        deployments["StabilityPool"],
        deployments["BorrowVault"],
        deployments["LendingPool"]
    )).wait();

    await (await borrowVault.initialize(
        deployments["AssetRegistry"],
        deployments["RiskEngine"],
        deployments["PythOracleAdapter"],
        deployments["LendingPool"],
        deployments["InterestEngine"],
        deployments["SchedulerEngine"],
        deployments["LiquidationEngine"]
    )).wait();

    await (await chronoRouter.initialize(
        deployments["PythOracleAdapter"],
        deployments["BorrowVault"],
        deployments["LendingPool"]
    )).wait();

    // Fund SchedulerEngine with 10 HBAR for HSS scheduling
    console.log("Funding SchedulerEngine with 10 HBAR...");
    try {
        await (await deployer.sendTransaction({ to: deployments["SchedulerEngine"], value: ethers.parseEther("10") })).wait();
    } catch (e: any) {
        console.warn("Funding SchedulerEngine failed:", e.message);
    }

    // Step 4.5: Token Associations
    console.log("Step 4.5: Associating Tokens via auto-association...");
    const contractsToAssociate = [
        deployments["LiquidationEngine"],
        deployments["StabilityPool"],
        deployments["LendingPool"],
        deployments["BorrowVault"],
        deployments["ChronoRouter"]
    ];

    if (deployments["wETH"]) {
        const wETH = await ethers.getContractAt("IERC20", deployments["wETH"]);
        for (const c of contractsToAssociate) {
            if (c && c !== ethers.ZeroAddress) {
                try { await (await wETH.transfer(c, 1)).wait(); } catch(e: any) { console.warn(`wETH transfer to ${c} failed:`, e.message); }
            }
        }
    }

    if (deployments["wUSDC"]) {
        const wUSDC = await ethers.getContractAt("IERC20", deployments["wUSDC"]);
        for (const c of contractsToAssociate) {
            if (c && c !== ethers.ZeroAddress) {
                try { await (await wUSDC.transfer(c, 1)).wait(); } catch(e: any) { console.warn(`wUSDC transfer to ${c} failed:`, e.message); }
            }
        }
    }

    // Step 5: Register Assets
    console.log("Step 5: Registering Assets...");
    // wUSDC config
    if (tokenAddresses["wUSDC"] && tokenAddresses["wUSDC"] !== ethers.ZeroAddress) {
        console.log("Registering wUSDC...");
        await (await assetRegistry.registerAsset({
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
            hardLiqPenalty: ethers.parseUnits("0.12", 18),
            hardLiqCollateralFloor: ethers.parseUnits("0.025", 18),
            stabilityPoolPenaltyShare: ethers.parseUnits("0.75", 18),
            reservePenaltyShare: ethers.parseUnits("0.25", 18),
            minBorrowDuration: 3600,
            maxBorrowDuration: 2592000, // 30 days
            isActive: true
        })).wait();
    }

    // wETH config
    if (tokenAddresses["wETH"] && tokenAddresses["wETH"] !== ethers.ZeroAddress) {
        console.log("Registering wETH...");
        await (await assetRegistry.registerAsset({
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
            hardLiqPenalty: ethers.parseUnits("0.12", 18),
            hardLiqCollateralFloor: ethers.parseUnits("0.025", 18),
            stabilityPoolPenaltyShare: ethers.parseUnits("0.75", 18),
            reservePenaltyShare: ethers.parseUnits("0.25", 18),
            minBorrowDuration: 3600,
            maxBorrowDuration: 2592000,
            isActive: true
        })).wait();
    }

    // wBTC config
    if (tokenAddresses["wBTC"] && tokenAddresses["wBTC"] !== ethers.ZeroAddress) {
        console.log("Registering wBTC...");
        await (await assetRegistry.registerAsset({
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
            hardLiqPenalty: ethers.parseUnits("0.12", 18),
            hardLiqCollateralFloor: ethers.parseUnits("0.025", 18),
            stabilityPoolPenaltyShare: ethers.parseUnits("0.75", 18),
            reservePenaltyShare: ethers.parseUnits("0.25", 18),
            minBorrowDuration: 3600,
            maxBorrowDuration: 2592000,
            isActive: true
        })).wait();
    }

    saveDeployments();
    console.log("Deployment Complete!");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
