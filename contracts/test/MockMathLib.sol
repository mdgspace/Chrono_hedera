// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MathLib} from "../libraries/MathLib.sol";

contract MockMathLib {
    function expNeg(uint256 x) external pure returns (uint256) {
        return MathLib.expNeg(x);
    }

    function computeLTV(uint256 base, uint256 max, uint256 k, uint256 t) external pure returns (uint256) {
        return MathLib.computeLTV(base, max, k, t);
    }

    function computeBuffer(uint256 minBuf, uint256 maxBuf, uint256 k, uint256 t) external pure returns (uint256) {
        return MathLib.computeBuffer(minBuf, maxBuf, k, t);
    }

    function compoundInterest(uint256 principal, uint256 annualRate, uint256 elapsedSeconds) external pure returns (uint256) {
        return MathLib.compoundInterest(principal, annualRate, elapsedSeconds);
    }
}
