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
            hardLiqCollateralFloor: 0,
            stabilityPoolPenaltyShare: 0,
            reservePenaltyShare: 0,
            minBorrowDuration: 0,
            maxBorrowDuration: 0,
            auctionPhase1Duration: 0,
            auctionPhase2Duration: 0,
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
        expect(config.hardLiqPenalty).to.equal(ethers.parseUnits("0.12", 18));
        expect(config.hardLiqCollateralFloor).to.equal(ethers.parseUnits("0.025", 18));
        expect(config.stabilityPoolPenaltyShare).to.equal(ethers.parseUnits("0.75", 18));
        expect(config.reservePenaltyShare).to.equal(ethers.parseUnits("0.25", 18));
        expect(config.minBorrowDuration).to.equal(3600);
        expect(config.maxBorrowDuration).to.equal(30 * 24 * 3600); // 30 days
        expect(await registry.isSupported(TOKEN_A)).to.be.true;
    });

    it("should allow custom hard liquidation waterfall parameters", async function () {
        const customConfig = {
            tokenAddress: TOKEN_A,
            decimals: 8,
            isStablecoin: false,
            ltvBase: ethers.parseUnits("0.70", 18),
            ltvMax: ethers.parseUnits("0.85", 18),
            kDecay: 7_614_000_000_000n,
            liquidationBonus: ethers.parseUnits("0.08", 18),
            closeFactor: ethers.parseUnits("0.5", 18),
            ltBufferMin: ethers.parseUnits("0.05", 18),
            ltBufferMax: ethers.parseUnits("0.20", 18),
            kLtBuffer: 7_614_000_000_000n,
            hardLiqPenalty: ethers.parseUnits("0.15", 18),
            hardLiqCollateralFloor: ethers.parseUnits("0.05", 18),
            stabilityPoolPenaltyShare: ethers.parseUnits("0.80", 18),
            reservePenaltyShare: ethers.parseUnits("0.20", 18),
            minBorrowDuration: 7200,
            maxBorrowDuration: 60 * 24 * 3600,
            auctionPhase1Duration: 0,
            auctionPhase2Duration: 0,
            isActive: true
        };

        await registry.connect(owner).registerAsset(customConfig);
        const config = await registry.getConfig(TOKEN_A);

        expect(config.hardLiqPenalty).to.equal(ethers.parseUnits("0.15", 18));
        expect(config.hardLiqCollateralFloor).to.equal(ethers.parseUnits("0.05", 18));
        expect(config.stabilityPoolPenaltyShare).to.equal(ethers.parseUnits("0.80", 18));
        expect(config.reservePenaltyShare).to.equal(ethers.parseUnits("0.20", 18));
    });

    it("should not allow non-owner to register", async function () {
        const config = {
            tokenAddress: TOKEN_A,
            decimals: 8,
            isStablecoin: false,
            ltvBase: 0, ltvMax: 0, kDecay: 0, liquidationBonus: 0, closeFactor: 0,
            ltBufferMin: 0, ltBufferMax: 0, kLtBuffer: 0, hardLiqPenalty: 0,
            hardLiqCollateralFloor: 0, stabilityPoolPenaltyShare: 0, reservePenaltyShare: 0,
            minBorrowDuration: 0, maxBorrowDuration: 0, auctionPhase1Duration: 0, auctionPhase2Duration: 0, isActive: false
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
            hardLiqCollateralFloor: 0, stabilityPoolPenaltyShare: 0, reservePenaltyShare: 0,
            minBorrowDuration: 0, maxBorrowDuration: 0, auctionPhase1Duration: 0, auctionPhase2Duration: 0, isActive: false
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
            hardLiqCollateralFloor: 0, stabilityPoolPenaltyShare: 0, reservePenaltyShare: 0,
            minBorrowDuration: 0, maxBorrowDuration: 0, auctionPhase1Duration: 0, auctionPhase2Duration: 0, isActive: false
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
            hardLiqCollateralFloor: 0, stabilityPoolPenaltyShare: 0, reservePenaltyShare: 0,
            minBorrowDuration: 0, maxBorrowDuration: 0, auctionPhase1Duration: 0, auctionPhase2Duration: 0, isActive: false
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

    it("should revert registerAsset if maxBorrowDuration exceeds 365 days", async function () {
        const invalidConfig = {
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
            hardLiqCollateralFloor: 0,
            stabilityPoolPenaltyShare: 0,
            reservePenaltyShare: 0,
            minBorrowDuration: 3600,
            maxBorrowDuration: 366 * 24 * 3600,
            auctionPhase1Duration: 0,
            auctionPhase2Duration: 0,
            isActive: true
        };

        await expect(
            registry.connect(owner).registerAsset(invalidConfig)
        ).to.be.revertedWithCustomError(registry, "DurationExceedsScheduleLimit")
          .withArgs(366 * 24 * 3600, 365 * 24 * 3600);
    });

    it("should revert updateAssetConfig if maxBorrowDuration exceeds 365 days", async function () {
        await registry.connect(owner).registerAsset({
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
            hardLiqCollateralFloor: 0,
            stabilityPoolPenaltyShare: 0,
            reservePenaltyShare: 0,
            minBorrowDuration: 3600,
            maxBorrowDuration: 30 * 24 * 3600,
            auctionPhase1Duration: 0,
            auctionPhase2Duration: 0,
            isActive: true
        });

        const updatedConfig = {
            tokenAddress: TOKEN_A,
            decimals: 8,
            isStablecoin: false,
            ltvBase: ethers.parseUnits("0.75", 18),
            ltvMax: ethers.parseUnits("0.90", 18),
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
            maxBorrowDuration: 366 * 24 * 3600,
            auctionPhase1Duration: 900,
            auctionPhase2Duration: 1800,
            isActive: true
        };

        await expect(
            registry.connect(owner).updateAssetConfig(TOKEN_A, updatedConfig)
        ).to.be.revertedWithCustomError(registry, "DurationExceedsScheduleLimit")
          .withArgs(366 * 24 * 3600, 365 * 24 * 3600);
    });

    it("should reject an asset term range with maximum below minimum", async function () {
        await registry.connect(owner).registerAsset({
            tokenAddress: TOKEN_A, decimals: 8, isStablecoin: false,
            ltvBase: 0, ltvMax: 0, kDecay: 0, liquidationBonus: 0, closeFactor: 0,
            ltBufferMin: 0, ltBufferMax: 0, kLtBuffer: 0, hardLiqPenalty: 0,
            hardLiqCollateralFloor: 0, stabilityPoolPenaltyShare: 0, reservePenaltyShare: 0,
            minBorrowDuration: 3600, maxBorrowDuration: 86400, auctionPhase1Duration: 0, auctionPhase2Duration: 0, isActive: true
        });
        const config = await registry.getConfig(TOKEN_A);
        await expect(registry.connect(owner).updateAssetConfig(TOKEN_A, {
            ...config.toObject(), minBorrowDuration: 86400, maxBorrowDuration: 3600
        })).to.be.revertedWithCustomError(registry, "InvalidDuration");
    });

    describe("auction phase durations", function () {
        const zeroConfig = {
            tokenAddress: TOKEN_A, decimals: 8, isStablecoin: false,
            ltvBase: 0, ltvMax: 0, kDecay: 0, liquidationBonus: 0, closeFactor: 0,
            ltBufferMin: 0, ltBufferMax: 0, kLtBuffer: 0, hardLiqPenalty: 0,
            hardLiqCollateralFloor: 0, stabilityPoolPenaltyShare: 0, reservePenaltyShare: 0,
            minBorrowDuration: 0, maxBorrowDuration: 0, auctionPhase1Duration: 0, auctionPhase2Duration: 0,
            isActive: true
        };

        it("applies the 15 min / 30 min auction defaults when registered with 0", async function () {
            await registry.connect(owner).registerAsset(zeroConfig);
            const config = await registry.getConfig(TOKEN_A);
            expect(config.auctionPhase1Duration).to.equal(900n);
            expect(config.auctionPhase2Duration).to.equal(1800n);
        });

        it("keeps custom auction durations on register and update", async function () {
            await registry.connect(owner).registerAsset({ ...zeroConfig, auctionPhase1Duration: 600, auctionPhase2Duration: 7200 });
            let config = await registry.getConfig(TOKEN_A);
            expect(config.auctionPhase1Duration).to.equal(600n);
            expect(config.auctionPhase2Duration).to.equal(7200n);

            await registry.connect(owner).updateAssetConfig(TOKEN_A, {
                ...config.toObject(), auctionPhase1Duration: 3600, auctionPhase2Duration: 4 * 3600
            });
            config = await registry.getConfig(TOKEN_A);
            expect(config.auctionPhase1Duration).to.equal(3600n);
            expect(config.auctionPhase2Duration).to.equal(4n * 3600n);
        });

        it("rejects auction durations outside [60 s, 1 h] and [60 s, 4 h] on update", async function () {
            await registry.connect(owner).registerAsset(zeroConfig);
            const config = (await registry.getConfig(TOKEN_A)).toObject();
            const cases: [number, number, number, number, number][] = [
                // phase1, phase2, offending value, min, max
                [0, 1800, 0, 60, 3600],
                [59, 1800, 59, 60, 3600],
                [3601, 1800, 3601, 60, 3600],
                [900, 0, 0, 60, 14400],
                [900, 59, 59, 60, 14400],
                [900, 14401, 14401, 60, 14400],
            ];
            for (const [p1, p2, bad, min, max] of cases) {
                await expect(registry.connect(owner).updateAssetConfig(TOKEN_A, {
                    ...config, auctionPhase1Duration: p1, auctionPhase2Duration: p2
                })).to.be.revertedWithCustomError(registry, "InvalidDuration").withArgs(bad, min, max);
            }
        });

        it("rejects out-of-bounds custom auction durations on register", async function () {
            await expect(registry.connect(owner).registerAsset({ ...zeroConfig, auctionPhase1Duration: 30 }))
                .to.be.revertedWithCustomError(registry, "InvalidDuration").withArgs(30, 60, 3600);
            await expect(registry.connect(owner).registerAsset({ ...zeroConfig, auctionPhase2Duration: 5 * 3600 }))
                .to.be.revertedWithCustomError(registry, "InvalidDuration").withArgs(5 * 3600, 60, 4 * 3600);
        });
    });
});
