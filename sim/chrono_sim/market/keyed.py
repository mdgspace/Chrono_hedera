"""Counter-based SplitMix64 substreams keyed by (root, asset, segment, level, piece).

A stream is a one-element uint64 array; equal keys give equal draws in any call order,
so refinements are reproducible across models and query orders (design 13.2).
"""
import math
import warnings
import numpy as np
from numba import njit

# Wrapping uint64 arithmetic is intended; only the JIT-disabled interpreter warns about it.
warnings.filterwarnings('ignore', 'overflow encountered in scalar', RuntimeWarning, __name__)

GOLDEN = np.uint64(0x9E3779B97F4A7C15)
M1, M2 = np.uint64(0xBF58476D1CE4E5B9), np.uint64(0x94D049BB133111EB)
S30, S27, S31, S11 = np.uint64(30), np.uint64(27), np.uint64(31), np.uint64(11)
SCALE = 2.0**-53


@njit(inline='always')
def mix(x):
    x = (x ^ (x >> S30)) * M1
    x = (x ^ (x >> S27)) * M2
    return x ^ (x >> S31)


@njit(inline='always')
def key_hash(root, asset, segment, level, piece):
    h = mix(np.uint64(root) + GOLDEN)
    for part in (asset, segment, level, piece):
        h = mix(h ^ (np.uint64(part & 0x7FFFFFFFFFFFFFFF) + GOLDEN))
    return h


@njit
def stream(root, asset, segment, level, piece):
    out = np.empty(1, np.uint64)
    out[0] = key_hash(root, asset, segment, level, piece)
    return out


@njit(inline='always')
def reseed(st, root, asset, segment, level, piece):
    """Reset st in place to the stream of the key, as stream() without allocating."""
    st[0] = key_hash(root, asset, segment, level, piece)
    return st


@njit(inline='always')
def uniform(st):
    """Uniform on the open interval (0, 1) with 53-bit resolution."""
    st[0] += GOLDEN
    return (np.float64(mix(st[0]) >> S11)+.5)*SCALE


@njit(inline='always')
def normal(st):
    return math.sqrt(-2.*math.log(uniform(st)))*math.cos(2.*math.pi*uniform(st))


@njit
def normals(st, shape0, shape1):
    out = np.empty((shape0, shape1))
    for i in range(shape0):
        for j in range(shape1):
            out[i, j] = normal(st)
    return out


@njit
def poisson(st, mean):
    """Inversion; exact for the moderate means of jump counts."""
    if mean <= 0:
        return 0
    if mean > 500:
        raise ValueError('poisson inversion supports means up to 500')
    k, p = 0, math.exp(-mean)
    cdf, u = p, uniform(st)
    while u > cdf and p > 0:
        k += 1
        p *= mean/k
        cdf += p
    return k
