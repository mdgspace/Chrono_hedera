"""I2 refinement with fixed buffers and unchanged per-bar random streams."""
import numpy as np
from .native_bridge import refine_bar
from chrono_sim.market.pathbatch import PathBatch


def pre_jump_low(batch, path, k, a, sigma, start, endpoint):
    """Minimum of the diffusion bridge ending at the pre-jump quote.

    A bar low also contains the post-jump close; P3c stops it leaking into the bridge.
    """
    if batch.diffusion_low is not None:
        return min(batch.diffusion_low[path, a, k], start, endpoint)
    low = batch.bar_low[path, a, k]
    if low < batch.log_price[path, a, k] or sigma == 0:
        return min(low, start, endpoint) if sigma else min(start, endpoint)
    raise ValueError('a jump bar whose low is its post-jump close needs diffusion_low')


def leg(batch, path, k, a, sigma, root):
    end = batch.log_price[path, a, k]
    pre = batch.pre_jump_log_price
    endpoint = pre[path, a, k] if pre is not None else end
    start = batch.log_price[path, a, k-1]
    if batch.jump_mask[path, a, k] and pre is None:
        raise ValueError('jump refinement requires optional pre_jump_log_price or a 1 s replay')
    if batch.jump_mask[path, a, k]:
        low = pre_jump_low(batch, path, k, a, sigma, start, endpoint)
    else:
        low = min(batch.bar_low[path, a, k], endpoint, start)
    values = refine_bar(batch.log_price[path, a, k-1], endpoint, low, sigma,
                        batch.t[k]-batch.t[k-1], 1.,
                        np.random.default_rng(np.random.SeedSequence([root, k, a])))
    values[-1] = end
    return values[1:]


def refined_path(batch, path, bars, sigma_per_s, rng):
    """Preallocate the old clock and quotes; no per-second Python objects."""
    root = int(rng.integers(0, 2**63-1))
    counts = np.ones(len(batch.t), dtype=np.int64)
    for k in range(1, len(batch.t)):
        if k in bars and batch.t[k]-batch.t[k-1] > 1:
            counts[k] = int(np.ceil(batch.t[k]-batch.t[k-1]))
    ends = np.cumsum(counts)
    n, assets = int(ends[-1]), len(batch.assets)
    t = np.empty(n)
    p, conf = [np.empty((n, assets)).T[None] for _ in range(2)]
    jumps = np.zeros((n, assets), dtype=bool).T[None]
    t[0], p[0, :, 0] = batch.t[0], batch.log_price[path, :, 0]
    conf[0, :, 0], jumps[0, :, 0] = batch.conf_frac[path, :, 0], batch.jump_mask[path, :, 0]
    for k in range(1, len(batch.t)):
        start, stop = ends[k-1], ends[k]
        if counts[k] == 1:
            t[start], p[0, :, start] = batch.t[k], batch.log_price[path, :, k]
        else:
            local = np.r_[np.arange(0., batch.t[k]-batch.t[k-1], 1.), batch.t[k]-batch.t[k-1]]
            t[start:stop] = batch.t[k-1]+local[1:]
            for a in range(assets):
                p[0, a, start:stop] = leg(batch, path, k, a, sigma_per_s[a], root)
        conf[0, :, start:stop] = batch.conf_frac[path, :, k-1, None]
        conf[0, :, stop-1], jumps[0, :, stop-1] = batch.conf_frac[path, :, k], batch.jump_mask[path, :, k]
    low = p.copy()
    for k in range(len(batch.t)):
        if k not in bars:
            low[0, :, ends[k]-1] = batch.bar_low[path, :, k]
    old = np.searchsorted(batch.t, t, side='right')-1
    return PathBatch(t, batch.assets, p, low, conf, jumps, batch.regime[path:path+1, old].copy(),
                     dict(batch.seed_info, refinement='I2/1s'))
