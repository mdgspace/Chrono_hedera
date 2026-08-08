import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { type AssetRegistry } from "../typechain-types";
import { type SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("AssetRegistry", function () {
    let registry: AssetRegistry;
    let owner: SignerWithAddress;
    let user: SignerWithAddress;
    
    const TOKEN_A = "0x0000000000000000000000000000000000000001";
    const TOKEN_B = "0x0000000000000000000000000000000000000002";

    beforeEach(async function () {
        [owner, user] = await ethers.getSigners();
        const RegistryFactory = await ethers.getContractFactory("AssetRegistry");
        registry = (await RegistryFactory.deploy(owner.address)) as any;
    });

    it("should register a new asset with defaults if params are 0", async function () {
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
            isActive: false // Should be overridden to true
        };

        await registry.connect(owner).registerAsset(emptyConfig);
        
        const config = await registry.getConfig(TOKEN_A);
        
        expect(config.isActive).to.be.true;
        expect(config.ltvBase).to.equal(ethers.parseUnits("0.75", 18));
        expect(config.ltvMax).to.equal(ethers.parseUnits("0.90", 18));
        expect(config.kDecay).to.equal(7_614_000_000_000n);
        expect(config.closeFactor).to.equal(ethers.parseUnits("0.5", 18));
        expect(config.liquidationBonus).to.equal(ethers.parseUnits("0.05", 18));
        expect(config.ltBufferMin).to.equal(ethers.parseUnits("0.05", 18));
        expect(config.ltBufferMax).to.equal(ethers.parseUnits("0.25", 18));
        expect(config.kLtBuffer).to.equal(7_614_000_000_000n);
        expect(config.hardLiqPenalty).to.equal(ethers.parseUnits("0.05", 18));
        expect(config.minBorrowDuration).to.equal(3600);
        expect(config.maxBorrowDuration).to.equal(30 * 24 * 3600); // 30 days
        expect(await registry.isSupported(TOKEN_A)).to.be.true;
    });

    it("should not allow non-owner to register", async function () {
        const config = {
            tokenAddress: TOKEN_A,
            decimals: 8,
            isStablecoin: false,
            ltvBase: 0, ltvMax: 0, kDecay: 0, liquidationBonus: 0, closeFactor: 0,
            ltBufferMin: 0, ltBufferMax: 0, kLtBuffer: 0, hardLiqPenalty: 0,
            minBorrowDuration: 0, maxBorrowDuration: 0, isActive: false
        };
        await expect(registry.connect(user).registerAsset(config))
            .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount")
            .withArgs(user.address);
    });

    it("should revert if registering twice", async function () {
        const config = {
            tokenAddress: TOKEN_A,
            decimals: 8,
            isStablecoin: false,
            ltvBase: 0, ltvMax: 0, kDecay: 0, liquidationBonus: 0, closeFactor: 0,
            ltBufferMin: 0, ltBufferMax: 0, kLtBuffer: 0, hardLiqPenalty: 0,
            minBorrowDuration: 0, maxBorrowDuration: 0, isActive: false
        };
        await registry.connect(owner).registerAsset(config);
        
        await expect(registry.connect(owner).registerAsset(config))
            .to.be.revertedWithCustomError(registry, "AssetAlreadyRegistered")
            .withArgs(TOKEN_A);
    });

    it("should revert on getting config for unsupported asset", async function () {
        await expect(registry.getConfig(TOKEN_A))
            .to.be.revertedWithCustomError(registry, "AssetNotSupported")
            .withArgs(TOKEN_A);
    });

    it("should deactivate an asset", async function () {
        const config = {
            tokenAddress: TOKEN_A,
            decimals: 8,
            isStablecoin: false,
            ltvBase: 0, ltvMax: 0, kDecay: 0, liquidationBonus: 0, closeFactor: 0,
            ltBufferMin: 0, ltBufferMax: 0, kLtBuffer: 0, hardLiqPenalty: 0,
            minBorrowDuration: 0, maxBorrowDuration: 0, isActive: false
        };
        await registry.connect(owner).registerAsset(config);
        
        expect(await registry.isSupported(TOKEN_A)).to.be.true;

        await registry.connect(owner).deactivateAsset(TOKEN_A);
        
        // It should still exist but not be supported
        const fetched = await registry.getConfig(TOKEN_A);
        expect(fetched.isActive).to.be.false;
        expect(await registry.isSupported(TOKEN_A)).to.be.false;
    });
    
    it("should return all assets", async function () {
        const configA = {
            tokenAddress: TOKEN_A,
            decimals: 8,
            isStablecoin: false,
            ltvBase: 0, ltvMax: 0, kDecay: 0, liquidationBonus: 0, closeFactor: 0,
            ltBufferMin: 0, ltBufferMax: 0, kLtBuffer: 0, hardLiqPenalty: 0,
            minBorrowDuration: 0, maxBorrowDuration: 0, isActive: false
        };
        const configB = {
            ...configA,
            tokenAddress: TOKEN_B
        };
        
        await registry.connect(owner).registerAsset(configA);
        await registry.connect(owner).registerAsset(configB);
        
        const assets = await registry.getAllAssets();
        expect(assets).to.have.lengthOf(2);
        expect(assets[0]).to.equal(TOKEN_A);
        expect(assets[1]).to.equal(TOKEN_B);
    });
});
