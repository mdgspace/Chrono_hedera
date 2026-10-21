"""Shared float formulas, compiled without fastmath for the event engine.

Layout: code, lambda, cap, sigma, z, theta, kappa, variance_floor, v_max,
fixed_rate (-1 means floating), r_max, delta_rate, L_eq, NEG base/max/k,
NEG buffer min/max/k, min_T, max_T, s_min, premium_floor_s, reserved (0),
8 tenor seconds, 8 ratios, 8 premium LTV nodes, 8 annual loss rates.
S1/S2/S3/flat opening results include the maturity-value discount AFTER the
curve cap; SPEC includes current APY INSIDE the capped formula.
Pass NaN for absent v0; callers resolve keeper staleness before this boundary.
Freeze kernel_params at origination for snapshot LT, refresh for floating LT.
"""
import math

from numba import njit
from numba.extending import register_jitable

YEAR = 31_536_000.0


@register_jitable
def interpolate(x, xs, ys):
    if x <= xs[0]:
        return ys[0]
    for i in range(1, len(xs)):
        if x <= xs[i]:
            return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1])
    return ys[-1]


@register_jitable
def variance(p, t, v0):
    v = p[5] if math.isnan(v0) else min(p[8], max(p[7], v0))
    x = p[6] * t
    weight = -math.expm1(-x) / x if x else 1.0
    return max(p[7], p[5] + (v - p[5]) * weight)


@register_jitable
def rate(p, apy):
    return p[9] if p[9] >= 0 else min(p[10], apy + p[11])


@register_jitable
def curve(p, T_s, v0, apy):
    code, t = int(p[0]), T_s / YEAR
    if code == 7:
        return p[13] + (p[14] - p[13]) * math.exp(-p[15] * T_s)
    if code == 3:
        return p[2]
    if code == 4:
        return p[12]
    if code == 1:
        rho = interpolate(math.sqrt(T_s), p[24:32] ** 0.5, p[32:40])
        return min(p[2], p[1] * rho)
    v = p[3] ** 2 if code in (5, 6) else variance(p, t, v0)
    exponent = p[4] * math.sqrt(v * t) + v * t / 2
    if code in (5, 6):
        exponent += apy * t
    return min(p[2], p[1] * math.exp(-exponent))


def open_limit_float(p, T_s, v0, apy):
    if not math.isfinite(T_s) or not p[19] <= T_s <= p[20]:
        raise ValueError('InvalidDuration')
    if not math.isfinite(apy) or apy < 0 or (not math.isnan(v0) and (not math.isfinite(v0) or v0 < 0)):
        raise ValueError('Invalid market input')
    result = curve(p, T_s, v0, apy)
    return result * math.exp(-rate(p, apy) * T_s / YEAR) if p[0] < 5 else result


def threshold_float(p, T_rem_s, t_el_s):
    if p[0] != 7:
        return p[1]
    if not math.isfinite(T_rem_s) or T_rem_s < p[19] or T_rem_s > p[20]:
        raise ValueError('InvalidDuration')
    if t_el_s < 0 or not math.isfinite(t_el_s):
        raise ValueError('Invalid elapsed time')
    ltv = p[13] + (p[14] - p[13]) * math.exp(-p[15] * T_rem_s)
    buf = p[16] + (p[17] - p[16]) * -math.expm1(-p[18] * t_el_s)
    return min(1.0, ltv + buf)


open_limit_nb = njit(cache=True)(open_limit_float)
threshold_nb = njit(cache=True)(threshold_float)
