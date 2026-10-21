"""Two float64 limbs preserve WAD rounding across SP claims near full depletion.

The state remains float64 SoA. Extra limbs retain scale/reward integer units
which a single float cannot represent above 2**53. No fastmath is permitted.
"""
import numpy as np
from numba import njit


@njit
def two_sum(a, b):
    s = a+b
    v = s-a
    return s, (a-(s-v))+(b-v)


@njit
def two_product(a, b):
    p = a*b
    split = 134217729.0
    ac, bc = split*a, split*b
    ah, bh = ac-(ac-a), bc-(bc-b)
    al, bl = a-ah, b-bh
    return p, ((ah*bh-p)+ah*bl+al*bh)+al*bl


@njit
def add_pair(a, al, b, bl):
    hi, lo = two_sum(a, b)
    return two_sum(hi, lo+al+bl)


@njit
def rounded_ratio(n, nl, d, dl=0.0, offset=0.5):
    q = n/d
    product, error = two_product(q, d)
    residual = ((n-product)-error)+nl-q*dl
    low = residual/d
    hi = np.floor(q)
    return two_sum(hi, np.floor((q-hi)+low+offset))


@njit
def wm_pair(a, b, al=0.0, bl=0.0):
    hi, lo = two_product(a, b)
    return rounded_ratio(hi, lo+al*b+a*bl+al*bl, 1e18)


@njit
def wd_pair(a, b, al=0.0, bl=0.0):
    hi, lo = two_product(a, 1e18)
    return rounded_ratio(hi, lo+al*1e18, b, bl)


@njit
def floor_mul_div(a, b, d):
    hi, lo = two_product(a, b)
    q, ql = rounded_ratio(hi, lo, d, 0., 0.)
    return q+ql


@njit
def floor_seizure(amount, pd, multiplier, scale, pc):
    hi, lo = two_product(amount, pd)
    ph, pl = two_product(hi, multiplier)
    ph, pl = two_sum(ph, pl+lo*multiplier)
    sh, sl = two_product(ph, scale)
    ph, pl = two_sum(sh, sl+pl*scale)
    dh, dl = two_product(pc, 1e18)
    q, ql = rounded_ratio(ph, pl, dh, dl, 0.)
    return q+ql
