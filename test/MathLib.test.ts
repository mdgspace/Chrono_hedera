import { expect } from "chai";
import { ethers } from "hardhat";

describe("MathLib", function () {
    let mathLibTest: any;
    const WAD = 10n ** 18n;

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

    describe("dynamicBonus", function () {
        const pct = (n: bigint) => n * WAD / 100n;

        it("floors at 2% when HF >= 1", async function () {
            expect(await mathLibTest.dynamicBonus(WAD)).to.equal(pct(2n));
            expect(await mathLibTest.dynamicBonus(ethers.parseUnits("1.3", 18))).to.equal(pct(2n));
        });

        it("rises 0.5% per 1% of HF below 1", async function () {
            expect(await mathLibTest.dynamicBonus(ethers.parseUnits("0.99", 18))).to.equal(ethers.parseUnits("0.025", 18));
            expect(await mathLibTest.dynamicBonus(ethers.parseUnits("0.9", 18))).to.equal(pct(7n));
            expect(await mathLibTest.dynamicBonus(ethers.parseUnits("0.85", 18))).to.equal(ethers.parseUnits("0.095", 18));
        });

        it("caps at 12% from HF 0.8 down", async function () {
            expect(await mathLibTest.dynamicBonus(ethers.parseUnits("0.8", 18))).to.equal(pct(12n));
            expect(await mathLibTest.dynamicBonus(ethers.parseUnits("0.5", 18))).to.equal(pct(12n));
            expect(await mathLibTest.dynamicBonus(0n)).to.equal(pct(12n));
        });
    });

    describe("computeDStar", function () {
        const HF_TARGET = ethers.parseUnits("1.05", 18);
        const UNIT = 10n ** 8n; // 8-decimal token units
        const wadMul = (a: bigint, b: bigint) => (a * b + WAD / 2n) / WAD;
        const wadDiv = (a: bigint, b: bigint) => (a * WAD + b / 2n) / b;

        it("matches the closed form and restores HF to the target", async function () {
            const D = 35000n * UNIT, C = 1n * UNIT;
            const pColl = 45000n * WAD, pDebt = WAD;
            const lt = ethers.parseUnits("0.7", 18), beta = ethers.parseUnits("0.07", 18);

            // (35000 * 1.05 - 45000 * 0.7) / (1.05 - 0.7 * 1.07) = 5250 / 0.301 = 17441.86...
            const dStar = await mathLibTest.computeDStar(D, C, pColl, pDebt, lt, HF_TARGET, beta);
            expect(dStar).to.equal(1744186046512n);

            const seized = wadDiv(wadMul(wadMul(dStar, pDebt), WAD + beta), pColl);
            const hfAfter = wadDiv(wadMul(wadMul(C - seized, pColl), lt), wadMul(D - dStar, pDebt));
            expect(hfAfter).to.be.closeTo(HF_TARGET, ethers.parseUnits("0.0001", 18));
        });

        it("returns full debt when HF_target - LT(1+beta) <= 0", async function () {
            const D = 1000n * UNIT, C = 1n * UNIT, p = 900n * WAD;
            // LT = 1.0 (RiskEngine's cap): 1.05 - 1.06 < 0 and 1.05 - 1.05 == 0
            expect(await mathLibTest.computeDStar(D, C, p, WAD, WAD, HF_TARGET, ethers.parseUnits("0.06", 18))).to.equal(D);
            expect(await mathLibTest.computeDStar(D, C, p, WAD, WAD, HF_TARGET, ethers.parseUnits("0.05", 18))).to.equal(D);
        });

        it("clamps to the outstanding debt", async function () {
            // (10000 * 1.05 - 9000 * 0.9) / (1.05 - 0.9 * 1.12) = 2400 / 0.042 = 57142 > 10000
            const D = 10000n * UNIT;
            const dStar = await mathLibTest.computeDStar(D, UNIT, 9000n * WAD, WAD,
                ethers.parseUnits("0.9", 18), HF_TARGET, ethers.parseUnits("0.12", 18));
            expect(dStar).to.equal(D);
        });

        it("returns zero when the position is already at or above the target", async function () {
            expect(await mathLibTest.computeDStar(1000n * UNIT, UNIT, 60000n * WAD, WAD,
                ethers.parseUnits("0.7", 18), HF_TARGET, ethers.parseUnits("0.02", 18))).to.equal(0n);
        });
    });
});
