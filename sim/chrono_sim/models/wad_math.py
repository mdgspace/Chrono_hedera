"""Independent integer-WAD model formulas using the P2 PRBMath exp port.

sqrt_wad is PRBMath UD60x18 sqrt: floor(sqrt(x * WAD)), with its uint256
product bound, using Python's exact stdlib isqrt for Common.sqrt's result.
Multiplication/division use MathLib round-half-up, sqrt and exp round down.
Each basic WAD rounding costs at most 1 wei; sqrt sensitivity at the minimum
one-second fraction of a year bounds the composed opening error by 1e-12
relative for the supplied illustrative domain (T >= 1 h, sigma <= 5, z <= 10,
kappa >= 1/year, floor >= .05, rates <= 1.075, L0 >= .00001).
For the full spec setter domain, acceptance allows 4 wei in addition to
1e-12 relative, accounting for exp inversion, capped body and discount
rounding. This is not uniform 1e-12 relative accuracy as L0 approaches zero.
S1's cancellation is reduced by evaluating (1-exp(-x))/x in integer WAD.
Durations and elapsed times are integer seconds; all other inputs/outputs WAD.
"""
from decimal import Decimal
from math import isqrt, isfinite

from chrono_sim.protocol.ref import prbmath
from chrono_sim.protocol.ref.wad import WAD, YEAR, MAX, uint, wad_mul, wad_div


def to_wad(value):
    return int(Decimal(str(value)) * WAD)


def sqrt_wad(x):
    uint(x)
    if x > MAX // WAD:
        from chrono_sim.protocol.ref.wad import Revert
        raise Revert('PRBMath_UD60x18_Sqrt_Overflow(uint256)')
    return isqrt(x * WAD)


def signed_mul(x, y):
    return wad_mul(abs(x), y) * (-1 if x < 0 else 1)


def interpolate_wad(x, xs, ys):
    if x <= xs[0]:
        return ys[0]
    for i in range(1, len(xs)):
        if x <= xs[i]:
            weight = wad_div(x - xs[i - 1], xs[i] - xs[i - 1])
            return ys[i - 1] + signed_mul(ys[i] - ys[i - 1], weight)
    return ys[-1]


def variance_wad(e, t, v0):
    floor = wad_mul(to_wad(e['sigma_floor']), to_wad(e['sigma_floor']))
    theta = to_wad(e['theta'])
    v = theta if v0 is None else min(to_wad(e['v_max']), max(floor, v0))
    x = wad_mul(to_wad(e['kappa']), t)
    weight = wad_div(WAD - prbmath.exp_neg(x), x) if x else WAD
    return max(floor, theta + signed_mul(v - theta, weight))


def curve_wad(pair, code, seconds, v0, apy):
    e, lam, cap = pair.extra, to_wad(pair.lam), to_wad(pair.cap)
    t = wad_div(seconds * WAD, YEAR * WAD)
    if code == 7:
        return prbmath.compute_ltv(to_wad(e['ltv_base']), to_wad(e['ltv_max']),
                                   to_wad(e['k_decay']), seconds)
    if code in (3, 4):
        return cap if code == 3 else to_wad(e['L_eq'])
    if code == 1:
        rho = interpolate_wad(sqrt_wad(seconds * WAD),
                              [sqrt_wad(s * WAD) for s in e['tenor_s']],
                              [to_wad(r) for r in e['ratios']])
        return min(cap, wad_mul(lam, rho))
    v = wad_mul(to_wad(e['sigma']), to_wad(e['sigma'])) if code in (5, 6) else variance_wad(e, t, v0)
    exponent = wad_mul(to_wad(e['z']), sqrt_wad(wad_mul(v, t))) + wad_mul(v, t) // 2
    if code in (5, 6):
        exponent += wad_mul(apy, t)
    return min(cap, wad_mul(lam, prbmath.exp_neg(exponent)))


def whole_seconds(value):
    if isinstance(value, bool) or not isfinite(value) or int(value) != value:
        raise ValueError('Integer seconds required for WAD')
    return int(value)


def open_wad(pair, code, seconds, v0, apy):
    seconds = whole_seconds(seconds)
    if not pair.min_T_s <= seconds <= pair.max_T_s:
        raise ValueError('InvalidDuration')
    uint(apy)
    if v0 is not None:
        uint(v0)
    result = curve_wad(pair, code, seconds, v0, apy)
    if code >= 5:
        return result
    e = pair.extra
    r = to_wad(e['r_fixed']) if e.get('r_fixed') is not None else min(to_wad(e['r_max']), apy + to_wad(e['delta_rate']))
    t = wad_div(seconds * WAD, YEAR * WAD)
    return wad_mul(result, prbmath.exp_neg(wad_mul(r, t)))


def threshold_wad(pair, code, remaining, elapsed):
    if code != 7:
        return to_wad(pair.lam)
    remaining, elapsed = whole_seconds(remaining), whole_seconds(elapsed)
    if not pair.min_T_s <= remaining <= pair.max_T_s:
        raise ValueError('InvalidDuration')
    if elapsed < 0:
        raise ValueError('Invalid elapsed time')
    e = pair.extra
    ltv = prbmath.compute_ltv(to_wad(e['ltv_base']), to_wad(e['ltv_max']), to_wad(e['k_decay']), remaining)
    buf = prbmath.compute_buffer(to_wad(e['buffer_min']), to_wad(e['buffer_max']), to_wad(e['k_buffer']), elapsed)
    return min(WAD, ltv + buf)


def premium_wad(pair, ltv, seconds):
    seconds = whole_seconds(seconds)
    e = pair.extra
    loss = interpolate_wad(ltv, [to_wad(x) for x in e['premium_ltv']], [to_wad(x) for x in e['EL_rate_perp']])
    time = wad_div(max(seconds, e['premium_floor_s']) * WAD, YEAR * WAD)
    return wad_mul(max(0, loss - to_wad(e['s_min'])), time)
