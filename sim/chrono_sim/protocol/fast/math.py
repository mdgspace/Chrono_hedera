"""Float64 arithmetic with the contracts' raw-unit rounding and checked bounds."""
import math
import numpy as np
from numba import njit
from .precision import wm_pair, wd_pair

WAD = 1e18
MAX = float(2**256-1)
YEAR = 31536000.0


@njit
def checked(x):
    if x < 0 or x >= MAX or not math.isfinite(x):
        raise ValueError(1)
    return x


@njit
def wm(a, b):
    checked(checked(a*b)+WAD/2)
    hi, lo = wm_pair(a, b)
    return hi+lo


@njit
def wd(a, b):
    if b == 0:
        raise ValueError(2)
    checked(checked(a*WAD)+np.floor(b/2))
    hi, lo = wd_pair(a, b)
    return hi+lo


@njit
def ratio(a, b):
    if b == 0:
        raise ValueError(3)
    return np.floor(a/b)


@njit
def ltv(cfg, duration):
    if duration < cfg[12] or duration > cfg[13]:
        raise ValueError(4)
    return cfg[0] + wm(cfg[1]-cfg[0], np.floor(WAD*math.exp(-cfg[2]*duration/WAD)))


@njit
def kink(stable, borrowed, deposits):
    u = 0.0 if deposits == 0 else wd(borrowed, deposits)
    base, opt, s1, s2 = (0.005, 0.9, 0.04, 0.6) if stable else (0.015, 0.8, 0.06, 1.0)
    if u <= opt*WAD:
        return base*WAD + wm(wd(u, opt*WAD), s1*WAD)
    return (base+s1)*WAD + wm(wd(u-opt*WAD, (1-opt)*WAD), s2*WAD)


@njit
def legacy_open(params, T_s, v0, apy):
    return params[0]+(params[1]-params[0])*math.exp(-params[2]*T_s)


@njit
def legacy_threshold(params, remaining, elapsed):
    return min(params[0]+(params[1]-params[0])*math.exp(-params[2]*remaining)
               + params[3]+(params[4]-params[3])*(1-math.exp(-params[5]*elapsed)), 1.0)
