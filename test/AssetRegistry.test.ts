import { expect } from "chai";
import { ethers } from "hardhat";
import { pairConfig } from "./helpers/pairs";

describe("AssetRegistry ordered risk markets", function () {
    const ETH = "0x0000000000000000000000000000000000000001";
    const USDC = "0x0000000000000000000000000000000000000002";

    it("stores risk only on ordered pairs and applies the requested defaults", async function () {
        const [owner] = await ethers.getSigners();
        const registry: any = await (await ethers.getContractFactory("AssetRegistry")).deploy(owner.address);
        await registry.registerAsset({ tokenAddress: ETH, decimals: 18, isStablecoin: false, isActive: true });
        await registry.registerAsset({ tokenAddress: USDC, decimals: 6, isStablecoin: true, isActive: true });
        expect(await registry.isPairSupported(ETH, USDC)).to.equal(false);
        await registry.registerPair(ETH, USDC, pairConfig());
        const forward = await registry.getPairConfig(ETH, USDC);
        expect(forward.ltvMax).to.equal(ethers.parseEther("0.90"));
        expect(forward.ltvBase).to.equal(ethers.parseEther("0.75"));
        expect(forward.ltMax).to.equal(ethers.parseEther("0.92"));
        expect(forward.ltBase).to.equal(ethers.parseEther("0.80"));
        expect(await registry.isPairSupported(USDC, ETH)).to.equal(false);
        await registry.registerPair(USDC, ETH, pairConfig({ ltvMax: ethers.parseEther("0.85") }));
        expect((await registry.getPairConfig(USDC, ETH)).ltvMax).to.equal(ethers.parseEther("0.85"));
        expect((await registry.getPairConfig(ETH, USDC)).ltvMax).to.equal(ethers.parseEther("0.90"));
        await registry.deactivatePair(ETH, USDC);
        expect(await registry.isPairSupported(ETH, USDC)).to.equal(false);
        expect(await registry.isPairSupported(USDC, ETH)).to.equal(true);
    });

    it("rejects unsafe pair endpoints and unauthorised changes", async function () {
        const [owner, stranger] = await ethers.getSigners();
        const registry: any = await (await ethers.getContractFactory("AssetRegistry")).deploy(owner.address);
        await registry.registerAsset({ tokenAddress: ETH, decimals: 18, isStablecoin: false, isActive: true });
        await registry.registerAsset({ tokenAddress: USDC, decimals: 6, isStablecoin: true, isActive: true });
        await expect(registry.connect(stranger).registerPair(ETH, USDC, pairConfig()))
            .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
        await expect(registry.registerPair(ETH, ETH, pairConfig()))
            .to.be.revertedWithCustomError(registry, "PairNotSupported");
        await expect(registry.registerPair(ETH, USDC, pairConfig({ ltvMax: ethers.parseEther("0.95") })))
            .to.be.revertedWithCustomError(registry, "InvalidPairConfig");
    });
});
