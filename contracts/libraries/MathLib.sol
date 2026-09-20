// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { UD60x18, ud, wrap, unwrap, UNIT } from "@prb/math/src/UD60x18.sol";
import { exp, inv, mul, div } from "@prb/math/src/ud60x18/Math.sol";

/**
 * @title MathLib
 * @notice Fixed-point WAD (1e18) math and protocol formulas.
 *         Uses PRBMath UD60x18 for exp/inv (base-2 bitshift internals, <0.001% precision).
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
     * @notice Compute e^(-x) using PRBMath's production-grade exp.
     *         Internally uses 2^(x * log2(e)) with bitshift decomposition.
     * @param x WAD-scaled value.
     * @return WAD-scaled result.
     */
    function expNeg(uint256 x) internal pure returns (uint256) {
        if (x == 0) return WAD;
        // For very large x, e^(-x) ≈ 0
        // PRBMath exp() max input is ~133e18, so x up to 133 WAD is safe
        if (x >= 133 * WAD) return 0;

        // e^(-x) = 1 / e^(x)
        UD60x18 expResult = exp(wrap(x));
        UD60x18 result = inv(expResult);
        return unwrap(result);
    }

    function computeLTV(
        uint256 ltvBase,
        uint256 ltvMax,
        uint256 k,
        uint256 tSeconds
    ) internal pure returns (uint256) {
        // LTV(t) = base + (max - base) * e^(-k*t)
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

    /**
     * @notice Computes continuous compound debt: principal * e^(r * t).
     *         Uses PRBMath UD60x18 exponential function (exp) to eliminate
     *         truncation and approximation errors present in Taylor series expansions.
     * @param principal Initial debt amount in token wei.
     * @param annualRate Annualized interest rate scaled to WAD (1e18).
     * @param elapsedSeconds Time elapsed in seconds.
     * @return Compounded total (principal + interest).
     */
    function compoundInterest(
        uint256 principal,
        uint256 annualRate,
        uint256 elapsedSeconds
    ) internal pure returns (uint256) {
        if (principal == 0 || elapsedSeconds == 0 || annualRate == 0) return principal;

        // x = (annualRate * elapsedSeconds) / SECONDS_PER_YEAR
        // Retain 18-decimal fixed-point precision by multiplying before dividing
        uint256 x = (annualRate * elapsedSeconds) / SECONDS_PER_YEAR;

        // PRBMath exp() overflows around ~133 WAD, clamp safely
        if (x >= 133 * WAD) {
            return type(uint256).max;
        }

        UD60x18 expFactor = exp(wrap(x));
        uint256 factorWad = unwrap(expFactor);

        return wadMul(principal, factorWad);
    }
}
