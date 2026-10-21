"""Exact coarse MK1/MK3 paths for the adaptive engine (P3C_METHOD.md sections 3 and 8).

Interface for generators that join the adaptive engine (P4 GARCH, Hawkes): supply per path
segment knots `t0, t1`, start values `x0` (post-jump), end values `x1` (pre-jump), one
role-space extreme `zmin` per segment and asset (`z = role * x`), jump times for the
confidence model, and numba refinement kernels with the exactness property of
`market/nested.py`: children are drawn from the conditional law given parent values and
extreme, from substreams keyed by `(root, asset, segment, level, piece)`.
Block bootstrap, replay, MK2 and MK4 do not implement it yet and keep the base-grid engine.
"""
from dataclasses import dataclass
from typing import NamedTuple
import math
import numpy as np
from numba import njit
from .common import YEAR, MarketParams, correlation, vector
from .jumpdiff import KouParams
from .keyed import stream, uniform, normal, poisson


class CoarsePath(NamedTuple):
    t0: np.ndarray
    t1: np.ndarray
    x0: np.ndarray
    x1: np.ndarray
    zmin: np.ndarray
    iv_first: np.ndarray
    iv_zmin: np.ndarray
    jump_t: np.ndarray
    jump_a: np.ndarray


@dataclass(frozen=True)
class AdaptiveMarket:
    """Market specification; paths are generated inside the engine from loop substreams."""
    params: MarketParams
    n_paths: int
    horizon_s: float
    coarse_dt_s: float = 3600.

    def __post_init__(self):
        if type(self.n_paths) is not int or self.n_paths < 1:
            raise ValueError('positive integer n_paths required')
        if not np.isfinite([self.horizon_s, self.coarse_dt_s]).all() or min(self.horizon_s, self.coarse_dt_s) <= 0:
            raise ValueError('positive finite horizon and coarse step required')
        if self.params.conf_c1 or self.params.conf_residuals:
            raise ValueError('realised-volatility confidence needs the base-grid engine')

    @property
    def assets(self):
        return self.params.assets

    def max_conf_frac(self):
        return self.params.conf_c0+self.params.conf_c2

    def arrays(self):
        """Per-asset per-second constants for the numba generator."""
        p, n = self.params, len(self.params.assets)
        sigma, mu = vector(p.sigma, n), vector(p.mu, n)
        rates, kou = np.zeros(n), (.5, 1., 2.)
        if isinstance(p, KouParams):
            rates = vector(p.jump_rate, n)
            mu = mu-rates*p.jump_mean_price()
            kou = (p.down_probability, p.eta_down, p.eta_up)
        values, vectors = np.linalg.eigh(correlation(p))
        root = np.ascontiguousarray(vectors @ np.diag(np.sqrt(np.maximum(values, 0))))
        return (np.log(vector(p.initial_price, n)), sigma/math.sqrt(YEAR), (mu-sigma**2/2)/YEAR,
                root, rates/YEAR, *kou)

    def stable(self):
        x, sig, drift, _, rates, *_ = self.arrays()
        return (sig == 0) & (rates == 0) & (drift == 0)

    def path(self, key, role):
        x, sig, drift, root, rates, pd, ed, eu = self.arrays()
        return CoarsePath(*coarse_path(x, sig, drift, root, rates, pd, ed, eu,
                                       np.asarray(role, np.float64), float(self.horizon_s),
                                       float(self.coarse_dt_s), int(key)))


@njit(inline='always')
def bridge_min(x, y, variance, u):
    """Inverse CDF of the continuous minimum of a Brownian bridge from x to y."""
    return (x+y-math.sqrt((x-y)**2-2.*variance*math.log(u)))/2.


@njit
def jumps(key, rates, pd, ed, eu, horizon):
    n = len(rates)
    streams = [stream(key, a, -1, 0, 0) for a in range(n)]
    counts = np.array([poisson(streams[a], rates[a]*horizon) for a in range(n)])
    times, assets, sizes = np.empty(counts.sum()), np.empty(counts.sum(), np.int64), np.empty(counts.sum())
    j = 0
    for a in range(n):
        for _ in range(counts[a]):
            times[j], assets[j] = uniform(streams[a])*horizon, a
            down = uniform(streams[a]) < pd
            e = -math.log(uniform(streams[a]))
            sizes[j] = -e/ed if down else e/eu
            j += 1
    return times, assets, sizes


@njit
def coarse_path(x_init, sig, drift, root, rates, pd, ed, eu, role, horizon, coarse_dt, key):
    n = len(x_init)
    times, assets, sizes = jumps(key, rates, pd, ed, eu, horizon)
    grid = np.append(np.arange(0., horizon, coarse_dt), horizon)
    knots = np.unique(np.concatenate((grid, times)))
    count = len(knots)-1
    landed = np.zeros((n, count+1))
    for j in range(len(times)):
        landed[assets[j], np.searchsorted(knots, times[j])] += sizes[j]
    x0, x1, zmin = np.empty((n, count)), np.empty((n, count)), np.empty((n, count))
    x, z = x_init.copy(), np.empty(n)
    for g in range(count):
        dt = knots[g+1]-knots[g]
        st = stream(key, -1, g, 0, 0)
        for a in range(n):
            z[a] = normal(st)
        w = root @ z
        for a in range(n):
            end = x[a]+drift[a]*dt+sig[a]*math.sqrt(dt)*w[a]
            x0[a, g], x1[a, g] = x[a], end
            za, zb = role[a]*x[a], role[a]*end
            if sig[a] > 0:
                zmin[a, g] = bridge_min(za, zb, sig[a]**2*dt, uniform(stream(key, a, g, 0, 1)))
            else:
                zmin[a, g] = min(za, zb)
            x[a] = end+landed[a, g+1]
    intervals = int(math.ceil(horizon/coarse_dt))
    first = np.searchsorted(knots[:-1], np.arange(intervals)*coarse_dt)
    iv_zmin = np.full((n, intervals), np.inf)
    for g in range(count):
        j = min(intervals-1, int(knots[g]//coarse_dt))
        for a in range(n):
            iv_zmin[a, j] = min(iv_zmin[a, j], zmin[a, g])
    return knots[:-1].copy(), knots[1:].copy(), x0, x1, zmin, first, iv_zmin, times, assets


def exposure_grid(path, sig, stable):
    """Stored-price proxy on segment starts: exact for constant legs, conditional bridge mean otherwise."""
    t = np.append(path.t0, path.t1[-1])
    prices = np.empty((path.x0.shape[0], len(t)))
    u = np.linspace(0., 1., 17)
    weights = np.r_[1., np.tile([4., 2.], 7), 4., 1.]/48.
    for a in range(path.x0.shape[0]):
        if stable[a]:
            prices[a] = math.exp(path.x0[a, 0])
            continue
        dt = path.t1-path.t0
        mean = path.x0[a][:, None]+(path.x1[a]-path.x0[a])[:, None]*u
        var = sig[a]**2*dt[:, None]*u*(1-u)
        prices[a, :-1] = np.exp(mean+var/2) @ weights
        prices[a, -1] = math.exp(path.x1[a, -1])
    return t, prices
