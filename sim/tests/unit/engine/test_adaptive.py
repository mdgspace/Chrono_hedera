"""P3c adaptive engine: skipped work is invisible, books with shared assets, determinism."""
import hashlib
import numpy as np
import pytest
from chrono_sim.engine import EventLoop, LoopConfig, Holder, Keeper, CapRoller
from chrono_sim.market.coarse import AdaptiveMarket
from chrono_sim.market.jumpdiff import KouParams
from chrono_sim.models import REGISTRY
from chrono_sim.models.config import load_pair
from chrono_sim.oracle.pyth_model import OracleConfig
from chrono_sim.protocol.ref.switches import Switches

HORIZON = 4*3600.


def market(assets=('HBAR', 'USDC'), sigma=(2., 0.), rate=(3000., 0.), paths=2, horizon=HORIZON):
    params = KouParams.model_validate(dict(assets=assets, initial_price=[2., 1., 3.][:len(assets)],
                                           sigma=list(sigma), jump_rate=list(rate), eta_down=8.))
    return AdaptiveMarket(params, paths, horizon)


def loop(model='B0_cap', exhaustive=False, switches=None, pairs=None, one_second=False, **settings):
    pairs = pairs or {('HBAR', 'USDC'): load_pair(model, 'HBAR_USDC')}
    cfg = LoopConfig(adaptive=True, hss_capacity=2000, sp_deposit=300., **settings)
    e = EventLoop(REGISTRY[model](), pairs, switches or Switches.m0(), cfg, Keeper(1.))
    e.exhaustive_scan, e.exhaustive_oracle = exhaustive, one_second
    return e


def book():
    terms = (3600., 7200., 10800.)
    return [Holder('HBAR', 'USDC', term_s=terms[i % 3], u=.98, rho_miss=.3, opened_at=float(120*i)) for i in range(6)]


def digest(r):
    return hashlib.sha256((r.positions.write_csv()+r.paths.write_csv()).encode()).hexdigest()


def compare(m, holders, make, seed):
    fast, slow = make(False), make(True)
    x, y = fast.run(m, holders, np.random.default_rng(seed)), slow.run(m, holders, np.random.default_rng(seed))
    assert x.positions.equals(y.positions) and x.paths.equals(y.paths)
    assert fast.stats['reverts'] == slow.stats['reverts']
    assert x.paths['conservation_error'].max() <= 1e-9
    return x, fast


@pytest.mark.parametrize('seed', range(3))
@pytest.mark.parametrize('model', ['B0_cap', 'S1'])
def test_skipped_windows_match_exhaustive_scan(seed, model):
    x, fast = compare(market(), book(), lambda ex: loop(model, ex), seed)
    if seed == 0 and model == 'B0_cap':
        # The workload must exercise liquidation, or skip-vs-exhaustive equality is vacuous.
        assert (x.positions['outcome'] == 'liquidated').sum() > 0


def test_outages_match_exhaustive_scan():
    oracle = OracleConfig(keeper_uptime=.7, outage_mean_s=90.)
    compare(market(), book(), lambda ex: loop('B0_cap', ex, oracle=oracle), 4)


def test_moving_debt_only_leg_matches_exhaustive_scan():
    m = market(('HBAR', 'ETH'), (2., 1.), (3000., 1000.))
    h = [Holder('HBAR', 'ETH', term_s=7200., u=.95, rho_miss=.3)]*3
    compare(m, h, lambda ex: loop('B0_cap', ex, switches=Switches(), pairs={}), 5)


def test_shared_asset_two_pair_book_matches_exhaustive_scan():
    m = market(('HBAR', 'USDC', 'ETH'), (2., 0., 1.5), (3000., 0., 2000.))
    h = [Holder('HBAR', 'USDC', term_s=7200., u=.95, rho_miss=.3), Holder('ETH', 'HBAR', term_s=10800., u=.95),
         Holder('ETH', 'USDC', term_s=3600., u=.9)]
    compare(m, h, lambda ex: loop('B0_cap', ex, switches=Switches(), pairs={}), 6)


def test_roller_batch_size_and_thread_count_determinism():
    from numba import get_num_threads, set_num_threads
    m, h = market(paths=3), book()+[CapRoller('HBAR', 'USDC', term_s=3600.)]
    old, hashes = get_num_threads(), set()
    try:
        for threads, size in ((1, 1), (min(2, old), 2), (min(2, old), 1000)):
            set_num_threads(threads)
            hashes.add(digest(loop(batch_size=size).run(m, h, np.random.default_rng(8))))
    finally:
        set_num_threads(old)
    assert len(hashes) == 1


def test_models_share_market_draws_and_stable_debt_exposure_is_exact():
    m = market(rate=(0., 0.), sigma=(0., 0.), paths=1)
    r = loop().run(m, [Holder('HBAR', 'USDC', term_s=7200., rho_miss=0.)], np.random.default_rng(1))
    row = r.positions.row(0, named=True)
    assert row['outcome'] == 'repaid'
    assert row['debt_time_integral'] == pytest.approx(row['principal_usd']*(7200.-60.), rel=1e-3)
    a = market().path(5, [1., -1.])
    assert all(np.array_equal(p, q) for p, q in zip(a, market().path(5, [1., -1.])))


def test_scan_search_reaching_a_horizon_on_the_heartbeat_grid_matches_exhaustive_scan():
    # HORIZON is a multiple of H, so the last window [HORIZON, HORIZON] holds one tick and no level-1 piece;
    # the search used to index coarse interval HORIZON/dc (out of bounds) and bound that window by +inf.
    h = book()+[CapRoller('HBAR', 'USDC', term_s=3600.)]
    compare(market(paths=2), h, lambda ex: loop('S1', ex), 0)


def stress_market(paths=2):
    # Near-continuous barrier crossings: exercises coarse/window descent, scans, soft liquidations and reverts.
    return market(sigma=(10., 0.), rate=(10000., 0.), paths=paths)


@pytest.mark.parametrize('model', ['B0_cap', 'S1'])
def test_stressed_scans_match_exhaustive_scan(model):
    x, fast = compare(stress_market(), book(), lambda ex: loop(model, ex), 0)
    assert fast.adaptive_counters['scans'] > 0 and (x.positions['soft_sp']+x.positions['soft_external']).sum() > 0
    assert fast.adaptive_counters['band_runs'] > 0


def test_stressed_scans_on_the_one_second_oracle_match_exhaustive_scan():
    x, fast = compare(stress_market(), book(), lambda ex: loop('S1', ex, one_second=True), 0)
    assert fast.adaptive_counters['scans'] > 0 and fast.adaptive_counters['pieces_refined'] > 0


def test_band_oracle_is_the_default_and_refines_no_one_second_path():
    e = loop()
    e.run(market(), book(), np.random.default_rng(0))
    c = e.adaptive_counters
    assert c['band_runs'] > 0 and c['pieces_refined'] == 0 and c['segments_refined'] == 0


def test_one_second_oracle_flag_selects_the_nested_refinement():
    e = loop(one_second=True)
    e.run(market(), book(), np.random.default_rng(0))
    c = e.adaptive_counters
    assert c['pieces_refined'] > 0 and c['band_runs'] == 0


NOJIT = pytest.mark.skipif(not __import__('numba').config.DISABLE_JIT, reason='patches a jitted kernel; run with NUMBA_DISABLE_JIT=1')


def full_pair_scan(s, r, now, threshold_nb, ids, stack, tight, rates):
    """Pre-pruning reference: every live member of a pair crossed by its 107.5%-grown top is tested."""
    import chrono_sim.engine.adaptive_loop as al
    m, count = len(r.tops), 0
    for c in range(m):
        for d in range(m):
            if r.tops[c, d] > 0 and al.price(s, c)/al.price(s, d) <= al.barrier_at(r.tops[c, d], now):
                n = r.book_counts[c*m+d]
                ids[count:count+n] = r.book_heaps[c*m+d, :n]
                count += n
    for i in np.sort(ids[:count]):
        if s.positions[i, al.ACTIVE] and not r.pending[i] and al.eligible(s, i, threshold_nb):
            r.pending[i] = True
            al.enqueue(r, now+r.settings[2], 2, 3, -1, i)


@NOJIT
@pytest.mark.parametrize('model', ['B0_cap', 'S1'])
def test_heap_pruned_scan_reproduces_the_full_pair_scan(monkeypatch, model):
    import chrono_sim.engine.adaptive_loop as al
    h = book()+[Holder('HBAR', 'USDC', term_s=10800., u=.5), CapRoller('HBAR', 'USDC', term_s=3600.)]
    run = lambda: digest(loop(model).run(stress_market(), h, np.random.default_rng(1)))
    pruned = run()
    monkeypatch.setattr(al, 'scan_live', full_pair_scan)
    assert run() == pruned


@NOJIT
@pytest.mark.parametrize('model', ['B0_cap', 'S1'])
def test_apy_grown_barriers_reproduce_the_107_percent_bound(monkeypatch, model):
    import chrono_sim.engine.adaptive_loop as al

    def loose(s, r, out, rates):
        out[:], rates[:] = r.tops, al.G
    h = book()+[Holder('HBAR', 'USDC', term_s=10800., u=.5), CapRoller('HBAR', 'USDC', term_s=3600.)]
    run = lambda: loop(model).run(stress_market(), h, np.random.default_rng(2))
    tight = run()
    monkeypatch.setattr(al, 'tight_tops', loose)
    monkeypatch.setattr(al, 'scan_live', full_pair_scan)
    assert digest(run()) == digest(tight)


@NOJIT
def test_apy_grown_barriers_skip_the_interest_false_positives_of_long_positions(monkeypatch):
    import chrono_sim.engine.adaptive_loop as al
    horizon = 20*86400.
    h = [Holder('HBAR', 'USDC', term_s=19*86400., u=u) for u in (.9, .95, .98, 1.)]

    def run():
        e = loop('B0_cap')
        r = e.run(market(sigma=(.3, 0.), rate=(0., 0.), paths=1, horizon=horizon), h, np.random.default_rng(0))
        return digest(r), e.adaptive_counters['scans']
    tight, tight_scans = run()
    monkeypatch.setattr(al, 'tight_tops', lambda s, r, out, rates: (out.__setitem__(slice(None), r.tops),
                                                                  rates.__setitem__(slice(None), al.G)))
    loose, loose_scans = run()
    assert tight == loose and tight_scans < 10 < 100_000 < loose_scans


def test_final_window_of_a_year_horizon_keeps_its_horizon_tick():
    # At 3.15e7 s, horizon + 1e-9 == horizon in float64, which used to leave the last tape empty.
    from chrono_sim.engine.adaptive_view import make_view, build_tape
    horizon = 31536000.
    m = market(sigma=(.6, 0.), rate=(20., 0.), paths=1, horizon=horizon)
    role = np.array([1., -1.])
    cfg = np.array([60., 3600., .4, .005, horizon, 0., 0., 0., 1.])
    v = make_view(m.path(3, role), role, m.arrays()[1], m.stable(), cfg, 3, np.array([0.]), np.array([True]))
    enter = np.array([[2., 1.], [0., 0.], [horizon-60., horizon-60.]])
    build_tape(v, int(horizon//60), 0, enter)
    assert v.tape_m[0] >= 1 and v.tape_t[0, 0] == horizon


@pytest.mark.skipif(__import__('numba').config.DISABLE_JIT, reason='a year of band windows needs the JIT')
def test_band_tape_of_a_year_horizon_reads_the_horizon_window():
    from chrono_sim.engine.adaptive_view import make_view, read
    horizon = 31536000.
    m = market(sigma=(.6, 0.), rate=(20., 0.), paths=1, horizon=horizon)
    role = np.array([1., -1.])
    cfg = np.array([60., 3600., .4, .005, horizon, 0., 0., 0., 0.])
    v = make_view(m.path(3, role), role, m.arrays()[1], m.stable(), cfg, 3, np.array([0.]), np.array([True]))
    out = np.empty((3, 2))
    read(v, horizon, out)
    assert out[2].max() == horizon


@NOJIT
@pytest.mark.parametrize('model', ['B0_cap', 'S1'])
def test_doomed_soft_liquidations_revert_in_the_kernel(monkeypatch, model):
    # Every call the engine skips must be one the protocol kernel reverts, leaving the state as retry() leaves it.
    import chrono_sim.engine.adaptive_loop as al
    from chrono_sim.engine.native_actions import execute, copy_state
    real, checked = al.retry, []

    def verified(s, r, i, now, threshold_nb, ids, stack, tight, rates):
        before = [a.copy() for a in copy_state(s)[:16]]+[s.positions.copy()]
        error = execute(s, 3, i, r.holders[0], None, None, None, threshold_nb, 0)[0]
        after = list(copy_state(s)[:16])+[s.positions]
        # execute() zeroes the flows (field 4) before it reverts; retry() does the same.
        assert error and not s.flows.any()
        assert [k for k, (a, b) in enumerate(zip(before, after)) if k != 4 and not np.array_equal(a, b, equal_nan=True)] == []
        checked.append(i)
        return real(s, r, i, now, threshold_nb, ids, stack, tight, rates)
    monkeypatch.setattr(al, 'retry', verified)
    # The fast-forward runs most links without retry(); test_fast_forwarded_links_are_doomed checks those.
    monkeypatch.setattr(al, 'fast_forward', lambda s, r, v, now, *rest: now)
    loop(model).run(stress_market(), book(), np.random.default_rng(0))
    assert len(checked) > 1000


@NOJIT
@pytest.mark.parametrize('model', ['B0_cap', 'S1'])
def test_skipped_doomed_retries_keep_records_and_stats(monkeypatch, model):
    import chrono_sim.engine.adaptive_loop as al

    def run():
        e = loop(model)
        r = e.run(stress_market(), book(), np.random.default_rng(0))
        return digest(r), e.stats['events'], e.stats['reverts'], e.adaptive_counters
    skipped, events, reverts, counters = run()
    monkeypatch.setattr(al, 'doomed', lambda s, r, i, now: False)
    executed, events_x, reverts_x, counters_x = run()
    assert (skipped, events, reverts) == (executed, events_x, reverts_x)
    assert counters['doomed_retries'] > 1000 and counters_x['doomed_retries'] == 0


@NOJIT
@pytest.mark.parametrize('model', ['B0_cap', 'S1'])
def test_fast_forwarded_chains_keep_records_and_stats(monkeypatch, model):
    import chrono_sim.engine.adaptive_loop as al

    def run():
        e = loop(model)
        r = e.run(stress_market(), book(), np.random.default_rng(0))
        c = e.adaptive_counters
        return (digest(r), e.stats['events'], e.stats['reverts'], c['scans'], c['doomed_retries']), c
    fast, counters = run()
    monkeypatch.setattr(al, 'fast_forward', lambda s, r, v, now, *rest: now)
    slow, counters_x = run()
    assert fast == slow
    assert counters['fast_forwarded'] > 1000 and counters_x['fast_forwarded'] == 0


@pytest.mark.parametrize('exhaustive', [False, True])
def test_count_scans_matches_the_next_scan_walk(exhaustive):
    # The fast-forward adds the scan ticks it skips; their count must be the number of next_scan steps.
    import chrono_sim.engine.adaptive_loop as al
    from chrono_sim.engine.adaptive_view import make_view
    m, role = stress_market(paths=1), np.array([1., -1.])
    cfg = np.array([60., 3600., .4, .005, HORIZON, float(exhaustive), 0., 0., 0.])
    view = lambda: make_view(m.path(3, role), role, m.arrays()[1], m.stable(), cfg, 3, np.array([0.]), np.array([True]))
    rng, walks = np.random.default_rng(7), []
    for case in range(12):
        lo = rng.uniform(0., HORIZON-600.)
        hi = lo+rng.uniform(1., 600.)
        tops, rates = np.zeros((2, 2)), np.array([0., -1e-7 if case % 4 == 0 else rng.uniform(0., 1e-6)])
        tops[0, 1] = rng.uniform(1.5, 2.5)
        v, u, walk = view(), lo, 0
        while (u := al.next_scan(v, tops, rates, u, hi)) < np.inf:
            walk += 1
        assert al.count_scans(view(), tops, rates, lo, hi) == walk, (case, lo, hi)
        walks.append(walk)
    assert max(walks) > 0 and min(walks) < max(walks)


@NOJIT
@pytest.mark.parametrize('model', ['B0_cap', 'S1'])
def test_fast_forwarded_links_are_doomed(monkeypatch, model):
    # Every link the fast-forward skips must be a soft liquidation the kernel reverts on the link's own clock and prices.
    import chrono_sim.engine.adaptive_loop as al
    from chrono_sim.engine.native_actions import execute, copy_state
    checked = []

    def verified(s, r, v, i, t, threshold_nb, tight, rates):
        assert al.doomed(s, r, i, t)
        before = [a.copy() for a in copy_state(s)[:16]]+[s.positions.copy()]
        error = execute(s, 3, i, r.holders[0], None, None, None, threshold_nb, 0)[0]
        after = list(copy_state(s)[:16])+[s.positions]
        assert error and not s.flows.any()
        assert [k for k, (a, b) in enumerate(zip(before, after)) if k != 4 and not np.array_equal(a, b, equal_nan=True)] == []
        checked.append(i)
    monkeypatch.setattr(al, 'before_link', verified)
    loop(model).run(stress_market(), book(), np.random.default_rng(0))
    assert len(checked) > 1000


@NOJIT
@pytest.mark.parametrize('model', ['B0_cap', 'S1'])
def test_stretch_cache_matches_stretch_of(monkeypatch, model):
    # A link that reuses the cached stretch must be one where tape, stretch_of and walk give what the cache holds.
    import chrono_sim.engine.adaptive_loop as al
    checked = []

    def verified(v, tops, rates, k, idx, slot, t):
        kt = al.window_of(v, t)
        fresh = al.tape(v, kt)
        it = al.stretch_of(v, fresh, t)
        assert (kt, fresh, it) == (k, slot, idx) and al.walk(v, tops, rates, k, idx, kt, it)
        checked.append(t)
    monkeypatch.setattr(al, 'stretch_cached', verified)
    loop(model).run(stress_market(), book(), np.random.default_rng(0))
    assert len(checked) > 1000
