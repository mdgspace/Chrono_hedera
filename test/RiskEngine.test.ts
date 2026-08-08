import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { type RiskEngine, type AssetRegistry } from "../typechain-types";
import { type SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("RiskEngine", function () {
    let registry: AssetRegistry;
    let riskEngine: RiskEngine;
    let owner: SignerWithAddress;
    
    const TOKEN_A = "0x0000000000000000000000000000000000000001";
    const WAD = 10n ** 18n;

    beforeEach(async function () {
        [owner] = await ethers.getSigners();
        
        const RegistryFactory = await ethers.getContractFactory("AssetRegistry");
        registry = (await RegistryFactory.deploy(owner.address)) as any;

        const RiskEngineFactory = await ethers.getContractFactory("RiskEngine");
        riskEngine = (await RiskEngineFactory.deploy(await registry.getAddress())) as any;

        // Register default asset
        const emptyConfig = {
            tokenAddress: TOKEN_A,
            decimals: 8,
            isStablecoin: false,
            ltvBase: 0,
            ltvMax: 0,
            kDecay: 0,
            liquidationBonus: 0,
            closeFactor: 0,
            ltBufferMin: 0,
            ltBufferMax: 0,
            kLtBuffer: 0,
            hardLiqPenalty: 0,
            minBorrowDuration: 0,
            maxBorrowDuration: 0,
            isActive: false
        };
        await registry.connect(owner).registerAsset(emptyConfig);
    });

    it("should revert computeMaxLTV on invalid duration", async function () {
        const minDuration = 3600n; // 1 hour
        const maxDuration = 2592000n; // 30 days (default)

        await expect(riskEngine.computeMaxLTV(TOKEN_A, minDuration - 1n))
            .to.be.revertedWithCustomError(riskEngine, "InvalidDuration")
            .withArgs(minDuration - 1n, minDuration, maxDuration);

        await expect(riskEngine.computeMaxLTV(TOKEN_A, maxDuration + 1n))
            .to.be.revertedWithCustomError(riskEngine, "InvalidDuration")
            .withArgs(maxDuration + 1n, minDuration, maxDuration);
    });

    it("should return ltvMax at duration=0 (if minBorrowDuration was 0)", async function () {
        // Adjust config to allow 0 duration for test
        const config = await registry.getConfig(TOKEN_A);
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
            minBorrowDuration: 0n,
            maxBorrowDuration: config.maxBorrowDuration,
            isActive: config.isActive
        };
        await registry.connect(owner).updateAssetConfig(TOKEN_A, newConfig);

        const ltv = await riskEngine.computeMaxLTV(TOKEN_A, 0n);
        expect(ltv).to.equal(ethers.parseUnits("0.90", 18));
    });

    it("should decrease monotonically and approach ltvBase", async function () {
        const ltv1 = await riskEngine.computeMaxLTV(TOKEN_A, 86400n); // 1 day
        const ltv3 = await riskEngine.computeMaxLTV(TOKEN_A, 259200n); // 3 days
        const ltv7 = await riskEngine.computeMaxLTV(TOKEN_A, 604800n); // 7 days

        // Should be decreasing
        expect(ltv1).to.be.lessThan(ethers.parseUnits("0.90", 18));
        expect(ltv3).to.be.lessThan(ltv1);
        expect(ltv7).to.be.lessThan(ltv3);

        // At 7 days, it should be very close to ltvBase (75%)
        // With default k=7.614e-6, e^(-k*7days) ≈ 0.01, so LTV ≈ 75% + 15%*0.01 = 75.15%
        const expectedLTV7 = ethers.parseUnits("0.7515", 18);
        const diff = ltv7 > expectedLTV7 ? ltv7 - expectedLTV7 : expectedLTV7 - ltv7;
        expect(diff).to.be.lessThan(ethers.parseUnits("0.001", 18)); // Within 0.1%
    });

    it("should return max uint256 for health factor when debt is 0", async function () {
        const hf = await riskEngine.computeHealthFactor(100n * WAD, 0n, TOKEN_A, 86400n, 0n);
        expect(hf).to.equal(ethers.MaxUint256);
    });

    it("should compute health factor correctly at t=0", async function () {
        // Collateral = $1000, Debt = $500
        // LTV(1 day) ≈ 82.8% (0.828)
        // buffer(0) = minBuffer = 5% (0.05)
        // LT = 82.8% + 5% = 87.8%
        // HF = ($1000 * 0.878) / $500 = 1.756
        
        const remainingDuration = 86400n; // 1 day
        const elapsed = 0n;
        const collValue = 1000n * WAD;
        const debtValue = 500n * WAD;

        const hf = await riskEngine.computeHealthFactor(collValue, debtValue, TOKEN_A, remainingDuration, elapsed);
        
        const ltv = await riskEngine.computeMaxLTV(TOKEN_A, remainingDuration);
        const buffer = ethers.parseUnits("0.05", 18);
        const lt = ltv + buffer; // ≈ 0.878
        const expectedHf = (collValue * lt) / WAD * WAD / debtValue; // WAD math

        expect(hf).to.equal(expectedHf);
    });

    it("should compute health factor capping LT at 100%", async function () {
        // Change config to force LT > 100%
        const config = await registry.getConfig(TOKEN_A);
        const newConfig = {
            tokenAddress: config.tokenAddress,
            decimals: config.decimals,
            isStablecoin: config.isStablecoin,
            ltvBase: WAD,
            ltvMax: WAD,
            kDecay: config.kDecay,
            liquidationBonus: config.liquidationBonus,
            closeFactor: config.closeFactor,
            ltBufferMin: WAD / 2n,
            ltBufferMax: WAD,
            kLtBuffer: config.kLtBuffer,
            hardLiqPenalty: config.hardLiqPenalty,
            minBorrowDuration: config.minBorrowDuration,
            maxBorrowDuration: config.maxBorrowDuration,
            isActive: config.isActive
        };
        await registry.connect(owner).updateAssetConfig(TOKEN_A, newConfig);

        const collValue = 1000n * WAD;
        const debtValue = 500n * WAD;
        
        // With LT capped at 100%, HF should be (1000 * 1.0) / 500 = 2.0
        const hf = await riskEngine.computeHealthFactor(collValue, debtValue, TOKEN_A, 86400n, 0n);
        expect(hf).to.equal(2n * WAD);
    });
});
