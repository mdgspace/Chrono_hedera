import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { LendingPool, AssetRegistry, ErrorLib, MockERC20 } from "../typechain-types";

describe("LendingPool", function () {
    let lendingPool: LendingPool;
    let assetRegistry: AssetRegistry;
    let wUSDC: any;
    let owner: HardhatEthersSigner;
    let user1: HardhatEthersSigner;
    let user2: HardhatEthersSigner;
    let authorized: HardhatEthersSigner;

    beforeEach(async function () {
        [owner, user1, user2, authorized] = await ethers.getSigners();

        // Deploy Mock ERC20
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        wUSDC = await MockERC20Factory.deploy("Wrapped USDC", "wUSDC", 8);

        // Deploy Asset Registry
        const AssetRegistryFactory = await ethers.getContractFactory("AssetRegistry");
        assetRegistry = await AssetRegistryFactory.deploy(owner.address);

        // Register wUSDC
        await assetRegistry.connect(owner).registerAsset({
            tokenAddress: await wUSDC.getAddress(),
            decimals: 8,
            isStablecoin: true,
            ltvBase: ethers.parseUnits("0.8", 18),
            ltvMax: ethers.parseUnits("0.97", 18),
            kDecay: 7614000000000n,
            liquidationBonus: ethers.parseUnits("0.03", 18),
            closeFactor: ethers.parseUnits("0.5", 18),
            ltBufferMin: ethers.parseUnits("0.05", 18),
            ltBufferMax: ethers.parseUnits("0.25", 18),
            kLtBuffer: 7614000000000n,
            hardLiqPenalty: ethers.parseUnits("0.05", 18),
            minBorrowDuration: 3600,
            maxBorrowDuration: 2592000,
            isActive: true
        });

        // Deploy Lending Pool
        const LendingPoolFactory = await ethers.getContractFactory("LendingPool");
        lendingPool = await LendingPoolFactory.deploy(await assetRegistry.getAddress(), owner.address);

        // Setup authorized caller
        await lendingPool.connect(owner).setAuthorized(authorized.address, true);

        // Mint tokens to users
        await wUSDC.mint(user1.address, ethers.parseUnits("1000", 8));
        await wUSDC.mint(user2.address, ethers.parseUnits("1000", 8));
    });

    it("should allow deposit and withdraw", async function () {
        const tokenAddr = await wUSDC.getAddress();
        const amount = ethers.parseUnits("100", 8);

        await wUSDC.connect(user1).approve(await lendingPool.getAddress(), amount);
        
        await expect(lendingPool.connect(user1).deposit(tokenAddr, amount))
            .to.emit(lendingPool, "Deposited")
            .withArgs(user1.address, tokenAddr, amount, amount); // first deposit shares == amount

        expect(await lendingPool.totalShares(tokenAddr)).to.equal(amount);
        expect(await lendingPool.userShares(user1.address, tokenAddr)).to.equal(amount);
        expect(await lendingPool.getTotalDeposits(tokenAddr)).to.equal(amount);

        await expect(lendingPool.connect(user1).withdraw(tokenAddr, amount))
            .to.emit(lendingPool, "Withdrawn")
            .withArgs(user1.address, tokenAddr, amount, amount);

        expect(await lendingPool.totalShares(tokenAddr)).to.equal(0);
        expect(await lendingPool.userShares(user1.address, tokenAddr)).to.equal(0);
        expect(await lendingPool.getTotalDeposits(tokenAddr)).to.equal(0);
    });

    it("should revert if depositing unsupported asset", async function () {
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        const unsupported = await MockERC20Factory.deploy("Unsupported", "UN", 18);
        const tokenAddr = await unsupported.getAddress();
        const amount = ethers.parseUnits("100", 18);
        
        await unsupported.mint(user1.address, amount);
        await unsupported.connect(user1).approve(await lendingPool.getAddress(), amount);

        await expect(lendingPool.connect(user1).deposit(tokenAddr, amount))
            .to.be.revertedWithCustomError(lendingPool, "AssetNotSupported")
            .withArgs(tokenAddr);
    });

    it("should compute proportional shares on multiple deposits", async function () {
        const tokenAddr = await wUSDC.getAddress();
        const amount1 = ethers.parseUnits("100", 8);
        const amount2 = ethers.parseUnits("200", 8);

        await wUSDC.connect(user1).approve(await lendingPool.getAddress(), amount1);
        await lendingPool.connect(user1).deposit(tokenAddr, amount1);

        // Simulate interest accrual / borrower repayment by sending tokens directly to pool
        await wUSDC.mint(await lendingPool.getAddress(), ethers.parseUnits("10", 8));
        
        // Deposits should be 110 now.
        expect(await lendingPool.getTotalDeposits(tokenAddr)).to.equal(ethers.parseUnits("110", 8));

        await wUSDC.connect(user2).approve(await lendingPool.getAddress(), amount2);
        await lendingPool.connect(user2).deposit(tokenAddr, amount2);

        // shares = amount * totalShares / totalDeposits = 200 * 100 / 110 = 181.81...
        const expectedShares = (amount2 * ethers.parseUnits("100", 8)) / ethers.parseUnits("110", 8);
        
        expect(await lendingPool.userShares(user2.address, tokenAddr)).to.equal(expectedShares);
    });

    it("should allow authorized to reserve and return borrow liquidity", async function () {
        const tokenAddr = await wUSDC.getAddress();
        const amount = ethers.parseUnits("100", 8);
        
        await wUSDC.connect(user1).approve(await lendingPool.getAddress(), amount);
        await lendingPool.connect(user1).deposit(tokenAddr, amount);

        await lendingPool.connect(authorized).reserveBorrowLiquidity(tokenAddr, ethers.parseUnits("50", 8));
        
        expect(await lendingPool.totalBorrowed(tokenAddr)).to.equal(ethers.parseUnits("50", 8));
        expect(await lendingPool.getTotalDeposits(tokenAddr)).to.equal(amount); // remains 100
        
        // Attempt to reserve more than available (pool has 100, 50 already borrowed, only 100 tokens exist in pool, wait, reserveBorrowLiquidity doesn't move tokens, just books it. But available = balanceOf(this) = 100)
        await expect(lendingPool.connect(authorized).reserveBorrowLiquidity(tokenAddr, ethers.parseUnits("101", 8)))
            .to.be.revertedWithCustomError(lendingPool, "InsufficientLiquidity");

        await lendingPool.connect(authorized).returnBorrowLiquidity(tokenAddr, ethers.parseUnits("50", 8));
        expect(await lendingPool.totalBorrowed(tokenAddr)).to.equal(0);
    });

    it("should revert unauthorized borrow liquidity methods", async function () {
        const tokenAddr = await wUSDC.getAddress();
        
        await expect(lendingPool.connect(user1).reserveBorrowLiquidity(tokenAddr, 100))
            .to.be.revertedWithCustomError(lendingPool, "Unauthorized");

        await expect(lendingPool.connect(user1).returnBorrowLiquidity(tokenAddr, 100))
            .to.be.revertedWithCustomError(lendingPool, "Unauthorized");
    });
});
