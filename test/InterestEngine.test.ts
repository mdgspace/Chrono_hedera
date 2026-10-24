import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { pairConfig } from "./helpers/pairs";

describe("InterestEngine duration plus adaptive utilization", function () {
    const ETH = "0x0000000000000000000000000000000000000001";
    const USDC = "0x0000000000000000000000000000000000000002";
    const ID = ethers.id("loan-1");
    const PRINCIPAL = ethers.parseEther("1000");

    async function fixture() {
        const [owner, vault] = await ethers.getSigners();
        const registry = await (await ethers.getContractFactory("AssetRegistry")).deploy(owner.address);
        await registry.registerAsset({ tokenAddress: ETH, decimals: 18, isStablecoin: false, isActive: true });
        await registry.registerAsset({ tokenAddress: USDC, decimals: 18, isStablecoin: true, isActive: true });
        await registry.registerPair(ETH, USDC, pairConfig());
        const pool = await (await ethers.getContractFactory("MockLendingPool")).deploy();
        const engine: any = await (await ethers.getContractFactory("InterestEngine"))
            .deploy(await pool.getAddress(), await registry.getAddress(), owner.address);
        await engine.setAuthorized(vault.address, true);
        await pool.setDeposits(USDC, PRINCIPAL);
        await pool.setBorrowed(USDC, PRINCIPAL * 85n / 100n);
        return { owner, vault, pool, engine };
    }

    it("quotes f1(T)+f2(T)+g(U) and switches the protocol f2 enum", async function () {
        const { engine } = await fixture();
        expect(await engine.getAdaptiveRate(USDC)).to.equal(ethers.parseEther("0.04"));
        const linear = await engine.durationRate(15 * 86400);
        await engine.setF2Shape(1); // quadratic
        const quadratic = await engine.durationRate(15 * 86400);
        await engine.setF2Shape(2); // cubic
        const cubic = await engine.durationRate(15 * 86400);
        expect(linear).to.be.greaterThan(quadratic);
        expect(quadratic).to.be.greaterThan(cubic);
        expect(await engine.quoteBorrowAPY(ETH, USDC, 15 * 86400)).to.equal(cubic + ethers.parseEther("0.04"));
        await engine.setDurationParameters(ethers.parseEther("0.08"), 10 * 86400, ethers.parseEther("0.03"));
        expect(await engine.durationRate(15 * 86400)).to.be.greaterThan(cubic);
    });

    it("freezes each loan's duration rate and accrues it only while debt exists", async function () {
        const { vault, engine } = await fixture();
        await engine.connect(vault).initPosition(ID, ETH, USDC, PRINCIPAL, 30 * 86400);
        const fixed = (await engine.positions(ID)).fixedAnnualRate;
        await engine.setF2Shape(2);
        await engine.setDurationParameters(ethers.parseEther("0.20"), 2 * 86400, ethers.parseEther("0.10"));
        expect((await engine.positions(ID)).fixedAnnualRate).to.equal(fixed);
        await time.increase(10 * 86400);
        const preview = await engine.previewTotalDebt(ID);
        expect(preview).to.be.greaterThan(await engine.getTotalDebt(ID));
        await engine.connect(vault).accrueInterest(ID);
        const debt = await engine.getTotalDebt(ID);
        expect(debt).to.be.closeTo(preview, ethers.parseEther("0.01"));
        const expected = PRINCIPAL * BigInt(Math.round(Math.exp(Number(fixed + ethers.parseEther("0.04")) / 1e18 * 10 / 365) * 1e12)) / 1000000000000n;
        expect(debt).to.be.closeTo(expected, ethers.parseEther("0.01"));
        await engine.connect(vault).clearPosition(ID);
        await time.increase(10 * 86400);
        await engine.connect(vault).accrueInterest(ID);
        expect(await engine.getTotalDebt(ID)).to.equal(0);
    });

    it("integrates utilization changes across pool checkpoints and adapts with a 50-day constant", async function () {
        const { vault, pool, engine } = await fixture();
        await engine.connect(vault).initPosition(ID, ETH, USDC, PRINCIPAL, 30 * 86400);
        await time.increase(10 * 86400);
        await engine.syncUtilization(USDC); // old pool utilization applies to preceding interval
        const before = (await engine.adaptiveState(USDC)).cumulativeRateSeconds;
        await pool.setBorrowed(USDC, PRINCIPAL * 95n / 100n);
        await time.increase(10 * 86400);
        await engine.connect(vault).accrueInterest(ID);
        const state = await engine.adaptiveState(USDC);
        expect(state.targetRate).to.be.greaterThan(ethers.parseEther("0.04"));
        expect(state.cumulativeRateSeconds - before).to.be.greaterThan(ethers.parseEther("0.04") * 10n * 86400n);
        expect(await engine.getTotalDebt(ID)).to.be.greaterThan(PRINCIPAL);
    });

    it("raises the target rate by one e-fold after 50 days at full utilization", async function () {
        const { pool, engine } = await fixture();
        await engine.syncUtilization(USDC);
        await pool.setBorrowed(USDC, PRINCIPAL);
        await time.increase(50 * 86400);
        await engine.syncUtilization(USDC);
        const state = await engine.adaptiveState(USDC);
        expect(state.targetRate)
            .to.be.closeTo(ethers.parseEther("0.108731273"), ethers.parseEther("0.000001"));
        const seconds = 50n * 86400n;
        // Integral of 5 * 4% * exp(t / 50 days) over the interval.
        expect(state.cumulativeRateSeconds).to.be.closeTo(
            ethers.parseEther("0.343656366") * seconds,
            ethers.parseEther("0.00001") * seconds
        );
    });
});
