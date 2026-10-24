import { expect } from "chai";
import { ethers } from "hardhat";
import { pairConfig } from "./helpers/pairs";

describe("RiskEngine pair duration curves", function () {
    const ETH = "0x0000000000000000000000000000000000000001";
    const USDC = "0x0000000000000000000000000000000000000002";
    const MIN = 3600;
    const MAX = 30 * 86400;

    async function fixture() {
        const [owner] = await ethers.getSigners();
        const registry = await (await ethers.getContractFactory("AssetRegistry")).deploy(owner.address);
        await registry.registerAsset({ tokenAddress: ETH, decimals: 18, isStablecoin: false, isActive: true });
        await registry.registerAsset({ tokenAddress: USDC, decimals: 6, isStablecoin: true, isActive: true });
        await registry.registerPair(ETH, USDC, pairConfig());
        await registry.registerPair(USDC, ETH, pairConfig({ ltvMax: ethers.parseEther("0.85") }));
        const engine = await (await ethers.getContractFactory("RiskEngine")).deploy(await registry.getAddress());
        return { registry, engine };
    }

    it("hits exact 90/75 LTV and 92/80 LT endpoints and decreases between them", async function () {
        const { engine } = await fixture();
        expect(await engine.computeMaxLTV(ETH, USDC, MIN)).to.equal(ethers.parseEther("0.90"));
        expect(await engine.computeMaxLTV(ETH, USDC, MAX)).to.equal(ethers.parseEther("0.75"));
        expect(await engine.computeLiquidationThreshold(ETH, USDC, MIN)).to.equal(ethers.parseEther("0.92"));
        expect(await engine.computeLiquidationThreshold(ETH, USDC, MAX)).to.equal(ethers.parseEther("0.80"));
        const day = await engine.computeMaxLTV(ETH, USDC, 86400);
        const week = await engine.computeMaxLTV(ETH, USDC, 7 * 86400);
        expect(day).to.be.lessThan(ethers.parseEther("0.90"));
        expect(week).to.be.lessThan(day);
        expect(week).to.be.greaterThan(ethers.parseEther("0.75"));
        expect(await engine.computeLiquidationThreshold(ETH, USDC, 86400))
            .to.be.greaterThan(await engine.computeMaxLTV(ETH, USDC, 86400));
    });

    it("uses the ordered pair and original duration for health factor", async function () {
        const { engine } = await fixture();
        expect(await engine.computeMaxLTV(USDC, ETH, MIN)).to.equal(ethers.parseEther("0.85"));
        expect(await engine.computeMaxLTV(ETH, USDC, MIN)).to.equal(ethers.parseEther("0.90"));
        expect(await engine.computeHealthFactor(ethers.parseEther("100"), ethers.parseEther("80"), ETH, USDC, MIN))
            .to.equal(ethers.parseEther("1.15"));
        expect(await engine.computeHealthFactor(1, 0, ETH, USDC, MIN)).to.equal(ethers.MaxUint256);
        await expect(engine.computeMaxLTV(ETH, USDC, MIN - 1)).to.be.revertedWithCustomError(engine, "InvalidDuration");
    });

    it("keeps outstanding debt assessable after a pair is deactivated", async function () {
        const { registry, engine } = await fixture();
        await registry.deactivatePair(ETH, USDC);
        await expect(engine.computeMaxLTV(ETH, USDC, MIN)).to.be.revertedWithCustomError(engine, "PairNotSupported");
        expect(await engine.computeLiquidationThreshold(ETH, USDC, MIN)).to.equal(ethers.parseEther("0.92"));
    });
});
