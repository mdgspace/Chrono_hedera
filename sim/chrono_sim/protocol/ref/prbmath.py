"""Exact PRBMath 4.2.0 UD60x18 exp/inv port, pinned in package-lock.json.

Derived from src/ud60x18/Math.sol and src/Common.sol.
MIT License, Copyright (c) 2023-present Paul Razvan Berg.
The complete MIT notice is in PRBMath-LICENSE.txt beside this module.
No floating point or Decimal approximation is used.
"""
from .wad import WAD, MAX, YEAR, Revert, uint, add, sub, mul, div, wad_mul, wad_div

EXP_MAX_INPUT = 133_084258667509499440
LOG2_E = 1_442695040888963407
FACTORS = (
    0x16A09E667F3BCC909,
    0x1306FE0A31B7152DF,
    0x1172B83C7D517ADCE,
    0x10B5586CF9890F62A,
    0x1059B0D31585743AE,
    0x102C9A3E778060EE7,
    0x10163DA9FB33356D8,
    0x100B1AFA5ABCBED61,
    0x10058C86DA1C09EA2,
    0x1002C605E2E8CEC50,
    0x100162F3904051FA1,
    0x1000B175EFFDC76BA,
    0x100058BA01FB9F96D,
    0x10002C5CC37DA9492,
    0x1000162E525EE0547,
    0x10000B17255775C04,
    0x1000058B91B5BC9AE,
    0x100002C5C89D5EC6D,
    0x10000162E43F4F831,
    0x100000B1721BCFC9A,
    0x10000058B90CF1E6E,
    0x1000002C5C863B73F,
    0x100000162E430E5A2,
    0x1000000B172183551,
    0x100000058B90C0B49,
    0x10000002C5C8601CC,
    0x1000000162E42FFF0,
    0x10000000B17217FBB,
    0x1000000058B90BFCE,
    0x100000002C5C85FE3,
    0x10000000162E42FF1,
    0x100000000B17217F8,
    0x10000000058B90BFC,
    0x1000000002C5C85FE,
    0x100000000162E42FF,
    0x1000000000B17217F,
    0x100000000058B90C0,
    0x10000000002C5C860,
    0x1000000000162E430,
    0x10000000000B17218,
    0x1000000000058B90C,
    0x100000000002C5C86,
    0x10000000000162E43,
    0x100000000000B1721,
    0x10000000000058B91,
    0x1000000000002C5C8,
    0x100000000000162E4,
    0x1000000000000B172,
    0x100000000000058B9,
    0x10000000000002C5D,
    0x1000000000000162E,
    0x10000000000000B17,
    0x1000000000000058C,
    0x100000000000002C6,
    0x10000000000000163,
    0x100000000000000B1,
    0x10000000000000059,
    0x1000000000000002C,
    0x10000000000000016,
    0x1000000000000000B,
    0x10000000000000006,
    0x10000000000000003,
    0x10000000000000001,
    0x10000000000000001,
)


def exp(x):
    uint(x)
    if x > EXP_MAX_INPUT:
        raise Revert('PRBMath_UD60x18_Exp_InputTooBig(uint256)')
    binary = (((x * LOG2_E) // WAD) << 64) // WAD
    result = 1 << 191
    for i, factor in enumerate(FACTORS):
        if binary & (1 << (63 - i)):
            result = (result * factor) >> 64
    return (result * WAD) >> (191 - (binary >> 64))


def inv(x):
    return div(WAD * WAD, uint(x))


def exp_neg(x):
    uint(x)
    if x >= 133 * WAD:
        return 0
    return inv(exp(x))


def compute_ltv(base, maximum, k, seconds):
    return add(base, wad_mul(sub(maximum, base), exp_neg(wad_mul(k, mul(seconds, WAD)))))


def compute_buffer(minimum, maximum, k, seconds):
    exponential = exp_neg(wad_mul(k, mul(seconds, WAD)))
    return add(minimum, wad_mul(sub(maximum, minimum), sub(WAD, exponential)))


def compound(principal, rate, seconds):
    if principal == 0 or seconds == 0 or rate == 0:
        return principal
    x = div(mul(rate, seconds), YEAR)
    return MAX if x >= 133 * WAD else wad_mul(principal, exp(x))


def kink(utilization, base, optimal, slope1, slope2):
    if utilization <= optimal:
        return add(base, wad_mul(wad_div(utilization, optimal), slope1))
    ratio = wad_div(sub(utilization, optimal), sub(WAD, optimal))
    return add(add(base, slope1), wad_mul(ratio, slope2))
