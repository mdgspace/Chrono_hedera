// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MathLib
 * @notice Fixed-point WAD (1e18) math and specific protocol formulas
 */
library MathLib {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant SECONDS_PER_YEAR = 31536000; // 365 days

    function wadMul(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0 || b == 0) return 0;
        return (a * b + (WAD / 2)) / WAD;
    }

    function wadDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b > 0, "MathLib: division by zero");
        return (a * WAD + (b / 2)) / b;
    }

    /**
     * @notice Compute e^(-x) via 6-term Taylor series.
     * @param x WAD-scaled value. accurate for x in [0, 10].
     * @return WAD-scaled result.
     */
    function expNeg(uint256 x) internal pure returns (uint256) {
        // e^-x = 1 - x + x^2/2! - x^3/3! + x^4/4! - x^5/5!
        if (x == 0) return WAD;
        if (x >= 10 * WAD) return 0; // effectively zero for e^-10

        uint256 x2 = wadMul(x, x);
        uint256 x3 = wadMul(x2, x);
        uint256 x4 = wadMul(x3, x);
        uint256 x5 = wadMul(x4, x);

        uint256 term2 = x2 / 2;
        uint256 term3 = x3 / 6;
        uint256 term4 = x4 / 24;
        uint256 term5 = x5 / 120;

        uint256 pos = WAD + term2 + term4;
        uint256 neg = x + term3 + term5;

        if (neg >= pos) return 0;
        return pos - neg;
    }

    function computeLTV(
        uint256 ltvBase,
        uint256 ltvMax,
        uint256 k,
        uint256 tSeconds
    ) internal pure returns (uint256) {
        // LTV(t) = base + (max - base) * e^(-k*t)
        // tSeconds must be WAD-scaled for the multiplication with k
        uint256 kt = wadMul(k, tSeconds * WAD);
        uint256 e = expNeg(kt);
        return ltvBase + wadMul(ltvMax - ltvBase, e);
    }

    function computeBuffer(
        uint256 bufferMin,
        uint256 bufferMax,
        uint256 kBuf,
        uint256 tElapsedSeconds
    ) internal pure returns (uint256) {
        // buffer(t) = bufferMin + (bufferMax - bufferMin) * (1 - e^(-k*t))
        uint256 kt = wadMul(kBuf, tElapsedSeconds * WAD);
        uint256 e = expNeg(kt);
        uint256 oneMinusE = WAD - e;
        return bufferMin + wadMul(bufferMax - bufferMin, oneMinusE);
    }

    function kinkRate(
        uint256 utilization,
        uint256 rBase,
        uint256 uOptimal,
        uint256 rSlope1,
        uint256 rSlope2
    ) internal pure returns (uint256) {
        if (utilization <= uOptimal) {
            // rate = rBase + (utilization / uOptimal) * rSlope1
            uint256 ratio = wadDiv(utilization, uOptimal);
            return rBase + wadMul(ratio, rSlope1);
        } else {
            // rate = rBase + rSlope1 + ((utilization - uOptimal) / (WAD - uOptimal)) * rSlope2
            uint256 excessU = utilization - uOptimal;
            uint256 excessDenom = WAD - uOptimal;
            uint256 ratio = wadDiv(excessU, excessDenom);
            return rBase + rSlope1 + wadMul(ratio, rSlope2);
        }
    }

    function compoundInterest(
        uint256 principal,
        uint256 annualRate,
        uint256 elapsedSeconds
    ) internal pure returns (uint256) {
        uint256 rSec = annualRate / SECONDS_PER_YEAR;
        uint256 rt = wadMul(rSec, elapsedSeconds * WAD);
        uint256 rt2 = wadMul(rt, rt) / 2;
        uint256 interestFactor = rt + rt2;
        return wadMul(principal, interestFactor);
    }
}
