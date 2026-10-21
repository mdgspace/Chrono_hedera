"""MK1 martingale-price GBM, including continuous intrabar minima."""

import numpy as np
from scipy.special import log_ndtr, ndtr
from .common import YEAR, MarketParams, bridge_low, clock, confidence, correlation, seed_info, vector
from .pathbatch import PathBatch

GBMParams = MarketParams


def generate(params, n_paths, horizon_s, dt_s, rng):
    params = params if isinstance(params, MarketParams) else GBMParams.model_validate(params)
    info, t = seed_info(rng), clock(n_paths, horizon_s, dt_s)
    return diffusion_batch(params, n_paths, t, rng, info)


def diffusion_batch(params, n_paths, t, rng, info, jump_sizes=None):
    """Diffuse to pre-jump quotes, then land jumps at their exact event times."""
    n, delta = len(params.assets), np.diff(t) / YEAR
    sigma = vector(params.sigma, n)
    values, vectors = np.linalg.eigh(correlation(params))
    root = vectors @ np.diag(np.sqrt(np.maximum(values, 0)))
    z = rng.standard_normal((n_paths, len(delta), n)) @ root.T
    increments = (z * sigma * np.sqrt(delta)[:, None]).transpose(0, 2, 1)
    increments += (vector(params.mu, n) - sigma**2 / 2)[None, :, None] * delta
    jumps = np.zeros((n_paths, n, len(t))) if jump_sizes is None else jump_sizes
    p = np.empty_like(jumps)
    p[:, :, 0] = np.log(vector(params.initial_price, n))
    p[:, :, 1:] = p[:, :, :1] + np.cumsum(increments + jumps[:, :, 1:], axis=2)
    pre = p - jumps
    low = p.copy()
    low[:, :, 1:] = bridge_low(
        p[:, :, :-1], pre[:, :, 1:], sigma[None, :, None]**2 * delta, rng)
    diffusion_low = low.copy()
    low = np.minimum(low, p)
    mask = jumps != 0
    return PathBatch(t, params.assets, p, low, confidence(p, mask, t, params, rng), mask,
                     np.zeros((n_paths, len(t)), dtype=np.int8), info,
                     pre if jump_sizes is not None else None, diffusion_low)


def first_passage(barrier, drift, sigma, horizon):
    """P(max X >= barrier), X=drift*t+sigma*W; all time units agree."""
    if min(sigma, horizon) < 0 or not np.isfinite([barrier, drift, sigma, horizon]).all():
        raise ValueError('finite inputs and nonnegative sigma/horizon required')
    if barrier <= 0:
        return 1.
    if sigma == 0 or horizon == 0:
        return float(drift * horizon >= barrier)
    s = sigma * np.sqrt(horizon)
    return float(ndtr((drift * horizon - barrier) / s) + np.exp(
        2 * drift * barrier / sigma**2 + log_ndtr((-barrier - drift * horizon) / s)))


def bgk_shift(sigma, dt):
    if min(sigma, dt) < 0 or not np.isfinite([sigma, dt]).all():
        raise ValueError('finite nonnegative sigma and dt required')
    return .5826 * sigma * np.sqrt(dt)
