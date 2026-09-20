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

    describe("compoundInterest", function () {
        const WAD = 10n ** 18n;
        const SECONDS_PER_YEAR = 31536000;

        it("should return principal when principal, rate, or elapsed time is zero", async function () {
            const principal = 1000n * WAD;
            const rate = 5n * WAD / 100n; // 5%

            expect(await mathLibTest.compoundInterest(0, rate, SECONDS_PER_YEAR)).to.equal(0n);
            expect(await mathLibTest.compoundInterest(principal, 0, SECONDS_PER_YEAR)).to.equal(principal);
            expect(await mathLibTest.compoundInterest(principal, rate, 0)).to.equal(principal);
        });

        it("should compute continuous compound interest accurately for moderate rates", async function () {
            // principal = $10,000, rate = 5.0% APY, duration = 1 year
            const principal = 10000n * WAD;
            const rate = 5n * WAD / 100n; // 0.05 WAD
            
            // Expected: 10000 * e^(0.05) ≈ 10000 * 1.0512710963760241 = 10512.710963760241
            const result = await mathLibTest.compoundInterest(principal, rate, SECONDS_PER_YEAR);
            const expected = ethers.parseUnits("10512.710963760241", 18);
            
            expect(result).to.be.closeTo(expected, ethers.parseUnits("0.0001", 18));
        });

        it("should eliminate the 27.72% Taylor series truncation error at high volatile rates (107.5% APY)", async function () {
            // principal = $100,000, rate = 107.5% APY, duration = 1 year
            const principal = 100000n * WAD;
            const rate = ethers.parseUnits("1.075", 18); // 107.5% APY
            
            // True exponential compounding: P * e^(1.075) ≈ 100,000 * 2.929995079 ≈ $292,999.51
            const result = await mathLibTest.compoundInterest(principal, rate, SECONDS_PER_YEAR);
            const expectedExponential = ethers.parseUnits("292999.5079", 18);
            expect(result).to.be.closeTo(expectedExponential, ethers.parseUnits("1.0", 18));

            // Former 2nd-order Taylor series: 1 + 1.075 + (1.075^2)/2 = 2.6528125
            // Accrued would have been: 100,000 * 2.6528125 = $265,281.25
            // Underestimation error eliminated: ~$27,718.26 (27.72% of principal)
            const taylorApproximation = ethers.parseUnits("265281.25", 18);
            const capturedLoss = result - taylorApproximation;
            const expectedDifference = ethers.parseUnits("27718.25", 18);
            expect(capturedLoss).to.be.closeTo(expectedDifference, ethers.parseUnits("1.0", 18));
        });

        it("should handle large overflow inputs safely by clamping", async function () {
            const principal = 1000n * WAD;
            const rate = ethers.parseUnits("200", 18); // 20000%
            const elapsed = SECONDS_PER_YEAR;

            const result = await mathLibTest.compoundInterest(principal, rate, elapsed);
            expect(result).to.equal(ethers.MaxUint256);
        });
    });
});
