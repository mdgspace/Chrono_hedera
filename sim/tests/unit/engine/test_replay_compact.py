"""The compact held-minute grid with refinement sigma 0 reproduces the 1 s held replay exactly, for every model."""
import numpy as np
import pytest

from scripts import equiv_engine as ee
from scripts import replay_engine as re_

MINUTE = 60*10**9
HORIZON = 4*3600.  # covers 1 h expiries, the 900 s grace and hard liquidations


@pytest.fixture(scope='module')
def series(tmp_path_factory):
    t = np.arange(re_.JAN1_2024_NS+MINUTE, re_.JAN1_2024_NS+3*86_400*10**9, MINUTE)
    rng = np.random.default_rng(3)
    close = .08*np.exp(np.cumsum(rng.normal(0, .004, len(t))))
    close[1440+30:1440+90] *= np.linspace(1, .55, 60)  # a crash 30 min into the first window
    close[1440+90:] *= .55
    path = tmp_path_factory.mktemp('replay')/'s.npz'
    np.savez(path, time_ns=t, close=close, low=close*.99)
    return str(path), int(t[1439])


@pytest.mark.parametrize('model', list(re_.MODELS))
def test_compact_grid_matches_one_second_replay(series, model):
    path, start = series
    c = dict(market='replay', variant='hold', model=model, book=10, ltv='stressed', switches=re_.MODELS[model])
    rows = []
    for compact, sigma in ((False, .6), (True, 0.)):
        loop = ee.make_loop(c, 'reference', sigma=sigma)
        batch = re_.window_batch(path, start, 'hold', HORIZON, compact=compact)
        records = loop.run(batch, ee.holders(10, .98), np.random.default_rng(11))
        rows.append(ee.summarise(records, 0)[0])
    assert len(re_.window_batch(path, start, 'hold', HORIZON).t) < len(re_.window_batch(path, start, 'hold', HORIZON, False).t)/25
    full, small = rows
    assert full['soft_sp']+full['soft_external'] > 0  # the crash liquidates
    for key in ('conservation', 'debt_time'):  # float sums over a different number of steps
        assert small.pop(key) == pytest.approx(full.pop(key), rel=1e-12, abs=1e-9)
    assert small == full
