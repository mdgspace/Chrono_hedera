import { expect } from "chai";
import { ethers } from "hardhat";

describe("BorrowFlow Integration [Testnet]", function () {
    let deployer: any;
    let user: any;
    
    // Deployed protocol contracts
    let registry: any;
    let pythOracle: any;
    let lendingPool: any;
    let borrowVault: any;
    let chronoRouter: any;
    
    // Tokens
    let wUSDC: any;
    let wBTC: any;
    
    // Pre-deployed Pyth contract on Hedera testnet
    const PYTH_ADDRESS = "0xA2aa501b19aff244D90cc15a4Cf739D2725B5729";
    
    before(async function () {
        const network = await ethers.provider.getNetwork();
        if (network.chainId !== 296n) {
            this.skip();
        }
        
        [deployer] = await ethers.getSigners();
        console.log("Using deployer:", deployer.address);
        
        // Ensure deployer has test tokens from somewhere or mint them if we deploy our own factory
        // We will deploy the full stack here to ensure clean state
        
        const Factory = await ethers.getContractFactory("WrappedTokenFactory");
        const factory = await Factory.deploy();
        await factory.waitForDeployment();
        
        // Deploy Mock ERC20s instead of HTS to avoid association issues for contracts
        const MockToken = await ethers.getContractFactory("MockERC20");
        wUSDC = await MockToken.deploy("Wrapped USDC", "wUSDC", 8);
        await wUSDC.waitForDeployment();
        wBTC = await MockToken.deploy("Wrapped BTC", "wBTC", 8);
        await wBTC.waitForDeployment();

        const usdcAddr = await wUSDC.getAddress();
        const btcAddr = await wBTC.getAddress();
        
        // Mint tokens to deployer
        await wUSDC.mint(deployer.address, 1000000n * 10n**8n);
        await wBTC.mint(deployer.address, 1000n * 10n**8n);
        
        // Deploy Protocol
        const Registry = await ethers.getContractFactory("AssetRegistry");
        registry = await Registry.deploy(deployer.address);
        await registry.waitForDeployment();
        
        const OracleAdapter = await ethers.getContractFactory("MockOracleAdapter");
        pythOracle = await OracleAdapter.deploy();
        await pythOracle.waitForDeployment();
        
        await pythOracle.setPrice(btcAddr, ethers.parseUnits("60000", 18), 8);
        await pythOracle.setPrice(usdcAddr, ethers.parseUnits("1", 18), 8);
        
        const LendingPool = await ethers.getContractFactory("LendingPool");
        lendingPool = await LendingPool.deploy(await registry.getAddress(), deployer.address);
        await lendingPool.waitForDeployment();
        
        const InterestEngine = await ethers.getContractFactory("InterestEngine");
        const interestEngine = await InterestEngine.deploy(await lendingPool.getAddress(), await registry.getAddress(), deployer.address);
        await interestEngine.waitForDeployment();
        
        const RiskEngine = await ethers.getContractFactory("RiskEngine");
        const riskEngine = await RiskEngine.deploy(await registry.getAddress());
        await riskEngine.waitForDeployment();
        
        const StabilityPool = await ethers.getContractFactory("StabilityPool");
        const stabilityPool = await StabilityPool.deploy();
        await stabilityPool.waitForDeployment();
        
        const SchedulerEngine = await ethers.getContractFactory("MockSchedulerEngine");
        const schedulerEngine = await SchedulerEngine.deploy();
        await schedulerEngine.waitForDeployment();
        
        const LiquidationEngine = await ethers.getContractFactory("LiquidationEngine");
        const liquidationEngine = await LiquidationEngine.deploy();
        await liquidationEngine.waitForDeployment();
        
        const BorrowVault = await ethers.getContractFactory("BorrowVault");
        borrowVault = await BorrowVault.deploy();
        await borrowVault.waitForDeployment();
        
        // Initialize Contracts
        await borrowVault.initialize(
            await registry.getAddress(),
            await riskEngine.getAddress(),
            await pythOracle.getAddress(),
            await lendingPool.getAddress(),
            await interestEngine.getAddress(),
            await schedulerEngine.getAddress(),
            await liquidationEngine.getAddress()
        );

        await liquidationEngine.initialize(
            await pythOracle.getAddress(),
            await registry.getAddress(),
            await interestEngine.getAddress(),
            await riskEngine.getAddress(),
            await stabilityPool.getAddress(),
            await borrowVault.getAddress(),
            await lendingPool.getAddress()
        );
        
        await stabilityPool.setLiquidationEngine(await liquidationEngine.getAddress());
        
        const Router = await ethers.getContractFactory("ChronoRouter");
        chronoRouter = await Router.deploy();
        await chronoRouter.waitForDeployment();
        
        await chronoRouter.initialize(
            await pythOracle.getAddress(),
            await borrowVault.getAddress(),
            await lendingPool.getAddress()
        );
        
        // Router and Vault need authorization
        await lendingPool.setAuthorized(await chronoRouter.getAddress(), true);
        await lendingPool.setAuthorized(await borrowVault.getAddress(), true);
        await interestEngine.setAuthorized(await borrowVault.getAddress(), true);
        
        // Config registry
        const btcConfig = {
            tokenAddress: btcAddr,
            decimals: 8,
            isStablecoin: false,
            ltvBase: 0n, // let registry use defaults
            ltvMax: 0n,
            kDecay: 0n,
            liquidationBonus: 0n,
            closeFactor: 0n,
            ltBufferMin: 0n,
            ltBufferMax: 0n,
            kLtBuffer: 0n,
            hardLiqPenalty: 0n,
            minBorrowDuration: 86400,
            maxBorrowDuration: 86400 * 365,
            isActive: true
        };
        const usdcConfig = { ...btcConfig, tokenAddress: usdcAddr, isStablecoin: true };
        
        await registry.registerAsset(btcConfig);
        await registry.registerAsset(usdcConfig);
    });
    
    it("should allow a full deposit-borrow-repay cycle", async function () {
        // user setup - on testnet we only have one funded account (deployer)
        [deployer] = await ethers.getSigners();
        
        const usdcAddr = await wUSDC.getAddress();
        const btcAddr = await wBTC.getAddress();
        
        // deployer has 1M USDC and 1k BTC
        // LP deposits 100k USDC
        await wUSDC.approve(await lendingPool.getAddress(), 100000n * 10n**8n);
        await lendingPool.deposit(usdcAddr, 100000n * 10n**8n, deployer.address);
        
        // deployer deposits 1 BTC and borrows 30k USDC
        await wBTC.approve(await chronoRouter.getAddress(), 1n * 10n**8n);
        
        const borrowAmount = 30000n * 10n**8n;
        const duration = 86400 * 30; // 30 days
        
        // open position
        let tx = await chronoRouter.openPositionWithPriceUpdate(
            [], // no pyth data needed for mock
            btcAddr,
            usdcAddr,
            1n * 10n**8n,
            borrowAmount,
            duration
        );
        
        let receipt = await tx.wait();
        
        // get position id
        const positionCreatedEvent = receipt?.logs.find((l: any) => {
            try {
                return borrowVault.interface.parseLog(l)?.name === "PositionOpened";
            } catch { return false; }
        });
        
        expect(positionCreatedEvent).to.not.be.undefined;
        const positionId = borrowVault.interface.parseLog(positionCreatedEvent).args.positionId;
        
        // deployer received USDC
        // Before borrow deployer had 1,000,000 - 100,000 = 900,000 USDC.
        // After borrow deployer should have 900,000 + 30,000 = 930,000 USDC.
        const userUsdcBal = await wUSDC.balanceOf(deployer.address);
        expect(userUsdcBal).to.equal(930000n * 10n**8n);
        
        // repay position
        await wUSDC.approve(await chronoRouter.getAddress(), borrowAmount + 1000n * 10n**8n); // approve extra for interest
        tx = await chronoRouter.repayWithPriceUpdate([], positionId, borrowAmount); // partial/full repay, we try full principal
        await tx.wait();
        
        // check position closed or debt reduced
        const pos = await borrowVault.getPosition(positionId);
        // We repaid exact principal, so remaining debt should just be a tiny amount of interest accrued over a few blocks
        expect(pos.borrowAmount).to.be.lessThan(100000n); // Less than 0.001 USDC
    });
});
