import { expect } from "chai";
import { ethers } from "hardhat";

describe("MathLib", function () {
    let mathLibTest: any;

    beforeEach(async function () {
        const MathLibTest = await ethers.getContractFactory("MockMathLib");
        mathLibTest = await MathLibTest.deploy();
    });

    it("should compute expNeg correctly", async function () {
        const WAD = 10n ** 18n;
        
        // e^0 = 1
        expect(await mathLibTest.expNeg(0)).to.equal(WAD);

        // e^(-1) = ~0.367879...
        const expNegWad = await mathLibTest.expNeg(WAD);
        // Precision is limited by Taylor series approximation in MathLib.
        // We expect it to be close to 0.367879... * 10^18
        const expected = 367879441171442321n;
        
        // Should be within a reasonable tolerance (e.g. 1%) depending on the terms used
        const diff = expNegWad > expected ? expNegWad - expected : expected - expNegWad;
        expect(diff).to.be.lessThan(expected / 100n);
    });

    it("should compute LTV curve", async function () {
        const WAD = 10n ** 18n;
        const base = 50n * WAD / 100n; // 0.5
        const max = 80n * WAD / 100n; // 0.8
        const k = 7614000000000n;
        
        // At t=0, LTV = max
        expect(await mathLibTest.computeLTV(base, max, k, 0)).to.equal(max);

        // At t=large, LTV approaches base
        const largeT = 31536000; // 1 year
        const ltvLarge = await mathLibTest.computeLTV(base, max, k, largeT);
        expect(ltvLarge).to.be.closeTo(base, base / 1000n);

        // Monotonically decreasing
        const t1 = 86400; // 1 day
        const t2 = 86400 * 7; // 7 days
        
        const ltv1 = await mathLibTest.computeLTV(base, max, k, t1);
        const ltv2 = await mathLibTest.computeLTV(base, max, k, t2);
        
        expect(max).to.be.greaterThan(ltv1);
        expect(ltv1).to.be.greaterThan(ltv2);
        expect(ltv2).to.be.greaterThan(base);
    });

    it("should compute Buffer correctly", async function () {
        const WAD = 10n ** 18n;
        const minBuf = 5n * WAD / 100n;
        const maxBuf = 25n * WAD / 100n;
        const k = 7614000000000n;
        
        // At t=0, buffer = minBuf
        expect(await mathLibTest.computeBuffer(minBuf, maxBuf, k, 0)).to.equal(minBuf);

        // At t=large, buffer approaches maxBuf
        const largeT = 31536000;
        const bufLarge = await mathLibTest.computeBuffer(minBuf, maxBuf, k, largeT);
        expect(bufLarge).to.be.closeTo(maxBuf, maxBuf / 100n);
    });
});
