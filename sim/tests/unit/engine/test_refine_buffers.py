"""Frozen pre-P3b materialisation checks, independent of the new buffers."""
import numpy as np
import pytest
from chrono_sim.market.intrabar import refine_bar
from chrono_sim.market.pathbatch import PathBatch
from chrono_sim.engine.refine import refined_path


def previous(batch, bars, sigma, rng):
    root = int(rng.integers(0, 2**63-1))
    t, p, conf, jumps = [0.], [batch.log_price[0, :, 0]], [batch.conf_frac[0, :, 0]], [batch.jump_mask[0, :, 0]]
    for k in range(1, len(batch.t)):
        duration = batch.t[k]-batch.t[k-1]
        if k not in bars or duration <= 1:
            t.append(float(batch.t[k])); p.append(batch.log_price[0, :, k])
            conf.append(batch.conf_frac[0, :, k]); jumps.append(batch.jump_mask[0, :, k])
            continue
        local, legs = np.r_[np.arange(0., duration, 1.), duration], []
        for a in range(len(batch.assets)):
            end, pre = batch.log_price[0, a, k], batch.pre_jump_log_price
            endpoint = pre[0, a, k] if pre is not None else end
            low = min(batch.bar_low[0, a, k], endpoint, batch.log_price[0, a, k-1])
            values = refine_bar(batch.log_price[0, a, k-1], endpoint, low, sigma[a], duration, 1.,
                                np.random.default_rng(np.random.SeedSequence([root, k, a])))
            values[-1] = end
            legs.append(values)
        for j in range(1, len(local)):
            t.append(float(batch.t[k-1]+local[j]))
            p.append(np.array([values[j] for values in legs]))
            conf.append(batch.conf_frac[0, :, k if j == len(local)-1 else k-1])
            jumps.append(batch.jump_mask[0, :, k] if j == len(local)-1 else np.zeros(len(batch.assets), bool))
    p, t = np.asarray(p).T[None], np.asarray(t)
    low = p.copy()
    for j, now in enumerate(t):
        source = np.searchsorted(batch.t, now)
        if source < len(batch.t) and batch.t[source] == now and source not in bars:
            low[0, :, j] = batch.bar_low[0, :, source]
    old = np.searchsorted(batch.t, t, side='right')-1
    return PathBatch(t, batch.assets, p, low, np.asarray(conf).T[None].copy(),
                     np.asarray(jumps).T[None].copy(), batch.regime[:, old].copy(),
                     dict(batch.seed_info, refinement='I2/1s'))


@pytest.mark.parametrize('bars', [set(), {1, 3}, {1, 2, 3, 4}])
@pytest.mark.parametrize('seed', range(20))
def test_buffers_preserve_every_quote_minimum_clock_and_seed(bars, seed):
    rng = np.random.default_rng(seed)
    t = np.array([0., 60., 120., 181.5, 182.])
    p = rng.normal(0., .01, (1, 2, len(t)))
    low = p.copy()
    low[:, :, 1:] = np.minimum(p[:, :, :-1], p[:, :, 1:])-.01
    mask = np.zeros_like(p, bool)
    mask[0, 0, 2] = True
    b = PathBatch(t, ('a', 'b'), p, low, rng.uniform(0., .01, p.shape), mask,
                  np.zeros((1, len(t)), np.int8), {}, pre_jump_log_price=p.copy())
    x, y = previous(b, bars, (.01, .01), np.random.default_rng(71)), refined_path(b, 0, bars, (.01, .01), np.random.default_rng(71))
    for name in ('t', 'log_price', 'bar_low', 'conf_frac', 'jump_mask', 'regime'):
        assert np.array_equal(getattr(x, name), getattr(y, name)), name
    assert x.seed_info == y.seed_info
