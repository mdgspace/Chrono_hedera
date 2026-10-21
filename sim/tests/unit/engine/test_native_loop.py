"""Native-loop fidelity, queue order and independently seeded multi-position paths."""
from dataclasses import replace
import hashlib
import os
import numpy as np
import pytest
from chrono_sim.engine import EventLoop, LoopConfig, Holder, CapRoller
from chrono_sim.engine.native_heap import push, pop
from chrono_sim.market.pathbatch import PathBatch
from chrono_sim.models import REGISTRY
from chrono_sim.models.config import load_pair
from chrono_sim.protocol.ref.switches import Switches


def loop(native, model='B0_cap', switches=None, **settings):
    pair = load_pair(model, 'HBAR_USDC')
    cfg = LoopConfig(native=native, sigma_per_s=(0., 0.), **settings)
    return EventLoop(REGISTRY[model](), {('HBAR', 'USDC'): pair}, switches or Switches.m0(), cfg)


def market(seed, paths=1):
    rng = np.random.default_rng(seed)
    t = np.array([0., 1., 120., 3600., 7140., 8101., 8102., 9000., 15000.])
    mid = (.5 if seed % 3 == 0 else 1.8 if seed % 3 == 1 else 2.)*rng.uniform(.995, 1.005)
    first = 1.95 if seed % 4 == 0 else mid
    p = np.log(np.array([[[2., first, mid, mid, mid, mid, mid, mid, mid], [1.]*len(t)]]))
    p = np.repeat(p, paths, axis=0)
    jumps = np.zeros_like(p, bool)
    jumps[:, 0, 1] = True
    pre = p.copy()
    pre[:, 0, 1] = np.log(2.)
    # Zero-volatility continuous sections and exact endpoint jumps.
    low = np.minimum(p, pre)
    low[:, :, 1:] = np.minimum(low[:, :, 1:], p[:, :, :-1])
    return PathBatch(t, ('HBAR', 'USDC'), p, low, np.zeros_like(p), jumps,
                     np.zeros((paths, len(t)), np.int8), {}, pre_jump_log_price=pre)


def holders(seed):
    return [Holder('HBAR', 'USDC', rho_miss=1.), Holder('HBAR', 'USDC'),
            CapRoller('HBAR', 'USDC', u=.1), Holder('HBAR', 'USDC', opened_at=120., term_s=3600.),
            Holder('HBAR', 'USDC', rho_miss=(seed % 2), term_s=21600.)]


def record_hash(records):
    return hashlib.sha256((records.positions.write_csv()+records.paths.write_csv()).encode()).hexdigest()


def test_fixed_heap_order_and_overflow():
    heap, n = np.empty((4, 6)), 0
    for at, priority, serial in ((2., 0, 0), (1., 2, 1), (1., 0, 3), (1., 0, 2)):
        n = push(heap, n, 10., at, priority, serial, 1, 0, 0)
    with pytest.raises(RuntimeError, match='capacity'):
        push(heap, n, 10., 0., 0, 4, 1, 0, 0)
    serials = []
    while n:
        row, n = pop(heap, n)
        serials.append(int(row[2]))
    assert serials == [2, 3, 1, 0]


def test_native_matches_previous_seeded_multi_position_paths():
    count = 200 if os.environ.get('P3B_FULL') else 3
    hashes = []
    for seed in range(count):
        b, h = market(seed), holders(seed)
        a, c = loop(False, sp_deposit=(seed % 2)*1e5), loop(True, sp_deposit=(seed % 2)*1e5)
        x = a.run(b, h, np.random.default_rng(seed))
        y = c.run(b, h, np.random.default_rng(seed))
        assert x.positions.equals(y.positions), f'position records seed {seed}'
        assert x.paths.equals(y.paths), f'path records seed {seed}'
        assert a.stats == c.stats, f'branches seed {seed}'
        assert y.paths['conservation_error'].max() <= 1e-9
        hashes.append(record_hash(y))
    if os.environ.get('CHRONO_RESULTS_DIR'):
        from pathlib import Path
        import json
        out = Path(os.environ['CHRONO_RESULTS_DIR'])/'native_paths.json'
        out.write_text(json.dumps(dict(paths=count, hashes=hashes), indent=2)+'\n')


@pytest.mark.parametrize('model', ['S1', 'B0_cap', 'SPEC', 'NEG'])
def test_native_models_match_previous(model):
    b, h = market(0), holders(0)
    a, c = loop(False, model), loop(True, model)
    x, y = a.run(b, h, np.random.default_rng(9)), c.run(b, h, np.random.default_rng(9))
    assert x.positions.equals(y.positions)
    assert x.paths.equals(y.paths)


def test_native_as_coded_matches_previous():
    b, h = market(1), holders(1)
    a, c = loop(False, switches=Switches()), loop(True, switches=Switches())
    x, y = a.run(b, h, np.random.default_rng(9)), c.run(b, h, np.random.default_rng(9))
    assert x.positions.equals(y.positions)
    assert x.paths.equals(y.paths)


def test_native_batch_size_and_thread_count_determinism():
    from numba import get_num_threads, set_num_threads
    old_threads = get_num_threads()
    hashes = []
    try:
        for threads, size in ((1, 1), (min(2, old_threads), 2), (1, 1000)):
            set_num_threads(threads)
            e = loop(True, batch_size=size)
            r = e.run(market(2, 4), [Holder('HBAR', 'USDC', rho_miss=.5)], np.random.default_rng(101))
            hashes.append(record_hash(r))
        assert len(set(hashes)) == 1
    finally:
        set_num_threads(old_threads)
    if os.environ.get('CHRONO_RESULTS_DIR'):
        from pathlib import Path
        (Path(os.environ['CHRONO_RESULTS_DIR'])/'native_determinism.txt').write_text('\n'.join(hashes)+'\n')


def test_windows_keep_unknown_debt_high_and_mixed_stored_quotes_conservative():
    from chrono_sim.engine.native_windows import bounds, next_oracle
    b = market(2)
    clock = np.arange(121., dtype=float)
    tops = np.zeros((2, 2))
    tops[0, 1] = 1.5
    stored = np.array([[2e8, 0., 0., 0., 0.], [1e8, 0., 0., 0., 0.]])
    assert next_oracle(clock, 2, 2., np.inf, bounds(b, 0, (0., 0.)), tops, stored) == 120
    # Nonzero debt volatility without a high bound cannot safely skip.
    assert next_oracle(clock, 2, 2., np.inf, bounds(b, 0, (0., .01)), tops, stored) == 3
    high = b.log_price.copy()
    high[:, :, 1:] = np.maximum(high[:, :, 1:], b.log_price[:, :, :-1])
    moving = replace(b, bar_high=high)
    assert next_oracle(clock, 2, 2., 60., bounds(moving, 0, (0., .01)), tops, stored) == 3


def test_indexed_book_heap_updates_and_removes_without_stale_entries():
    from chrono_sim.engine.native_book_heap import update
    keys, heap, locations = np.zeros(8), np.empty(8, np.int64), np.full(8, -1, np.int64)
    live, count = {}, 0
    rng = np.random.default_rng(17)
    for _ in range(80):
        i, value = int(rng.integers(8)), float(rng.integers(5))
        count = update(heap, locations, keys, count, i, value)
        if value:
            live[i] = value
        else:
            live.pop(i, None)
        assert count == len(live)
        assert not count or keys[heap[0]] == max(live.values())
        assert all(locations[heap[j]] == j for j in range(count))


@pytest.mark.parametrize('uptime', [0., .6, 1.])
def test_native_compressed_oracle_matches_all_queries(uptime):
    from chrono_sim.oracle.pyth_model import OracleModel, OracleConfig
    from chrono_sim.engine.native_oracle import NativeOracle
    t = np.arange(121., dtype=float)
    rng = np.random.default_rng(41)
    p = rng.normal(0., .02, (1, 2, len(t)))
    b = PathBatch(t, ('HBAR', 'USDC'), p, p.copy(), np.full_like(p, .001),
                  np.zeros_like(p, bool), np.zeros((1, len(t)), np.int8), {})
    cfg = OracleConfig(keeper_uptime=uptime, outage_mean_s=3., heartbeat_s=11.)
    a, c = OracleModel(b, cfg, np.random.default_rng(17)), NativeOracle(b, cfg, np.random.default_rng(17))
    for now in np.unique(np.r_[t, rng.uniform(0., 120., 60)]):
        for asset in b.assets:
            assert a.stored(0, asset, now) == c.stored(0, asset, now)
    assert np.array_equal(a.arrays()[0][0], c.prices_on_grid())


@pytest.mark.parametrize('decimals', [{'HBAR': 18, 'USDC': 6}, {'HBAR': 6, 'USDC': 18}])
def test_native_decimal_conversion_exceeds_int64_without_overflow(decimals):
    b, h = market(2), [Holder('HBAR', 'USDC')]
    a, c = loop(False, token_decimals=decimals, lp_deposit=1e6), loop(True, token_decimals=decimals, lp_deposit=1e6)
    x, y = a.run(b, h, np.random.default_rng(19)), c.run(b, h, np.random.default_rng(19))
    assert x.positions.equals(y.positions)
    assert x.paths.equals(y.paths)


def test_native_failed_open_restores_every_affected_ledger():
    b, h = market(2), [Holder('HBAR', 'USDC')]*7
    a, c = loop(False, hss_capacity=1), loop(True, hss_capacity=1)
    x, y = a.run(b, h, np.random.default_rng(19)), c.run(b, h, np.random.default_rng(19))
    assert a.stats == c.stats
    assert len(x.positions) == 6
    assert x.positions.equals(y.positions)
    assert x.paths.equals(y.paths)
