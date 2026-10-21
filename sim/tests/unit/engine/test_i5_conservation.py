"""I5 collection: the incremental conservation scan reproduces the per-action full check exactly."""
import hashlib
import numpy as np
import pytest
from chrono_sim.engine import adaptive_adapter, native_adapter
from chrono_sim.engine.records import RecordBook
from chrono_sim.engine.conservation import pairwise_sum
from chrono_sim.protocol.fast.engine import Engine
from chrono_sim.protocol.fast.state import clone, B, ACTIVE, DEBT
from test_adaptive import market, book, loop as adaptive_loop
import test_native_loop as fixture


def legacy_collect(path, e, initial, grid, horizon, holders, logs, cfg):
    """Pre-I5-fix collection: full numpy conservation check after every logged action."""
    final, e.state = e.state, initial
    records = RecordBook(path, e, cfg.impact, cfg.basis, cfg.reserve_reimburses, grid)
    before = clone(initial)
    actions = {2: 'repay', 3: 'softLiquidate', 4: 'scheduled', 5: 'scheduled'}
    s = e.state
    for kind, i, h, p, q, b0, b1, lp0, lp1, flows, prices, now in logs:
        if kind == 7:
            records.stopped(i, 'collateral_exhausted')
            continue
        before.positions[i], before.balances[:], before.lp[:] = p, b0, lp0
        before.prices[:], before.meta[0] = prices, now
        s.positions[i], s.balances[:], s.lp[:] = q, b1, lp1
        s.flows[:], s.prices[:], s.meta[0] = flows, prices, now
        if kind == 1:
            debt = int(q[6])
            sp, reserve = flows[debt, 1, -3], flows[debt, 1, 0]
            e.open_premiums[str(i+1)] = sp+reserve, sp
            records.opened(i, holders[h].strategy)
        else:
            records.observe(before, actions[kind], i)
        e.check_conservation()
    e.state = final
    return records.finish(horizon)


def bitwise(r):
    h = hashlib.sha256()
    for frame in (r.positions, r.paths):
        for name in frame.columns:
            column = frame[name]
            h.update(name.encode())
            h.update(column.to_numpy().tobytes() if column.dtype.is_numeric() else '\0'.join(column.to_list()).encode())
    return h.hexdigest()


def run_with(module, collect, run):
    old = module.collect
    module.collect = collect
    try:
        return run()
    finally:
        module.collect = old


def adaptive_run(seed=0):
    return adaptive_loop('B0_cap').run(market(), book(), np.random.default_rng(seed))


def native_run(seed=0):
    return fixture.loop(True, sp_deposit=(seed % 2)*1e5).run(fixture.market(seed), fixture.holders(seed),
                                                              np.random.default_rng(seed))


@pytest.mark.parametrize('n', [*range(0, 140), 255, 256, 257, 1000, 1031, 4100, 40000])
def test_pairwise_sum_reproduces_numpy_sum_bit_for_bit(n):
    rng = np.random.default_rng(n)
    x = rng.standard_normal(n)*10.0**rng.integers(-3, 26, n)
    assert pairwise_sum(x, n) == x.sum()
    rows = rng.standard_normal((2, n))*1e26
    assert all(pairwise_sum(rows[t], n) == rows.sum(axis=1)[t] for t in range(2))


@pytest.mark.parametrize('seed', range(3))
def test_adaptive_collection_matches_per_action_full_check(seed):
    old = run_with(adaptive_adapter, legacy_collect, lambda: adaptive_run(seed))
    new = adaptive_run(seed)
    assert old.paths['conservation_error'].max() > 0
    assert bitwise(old) == bitwise(new)


@pytest.mark.parametrize('seed', range(3))
def test_native_collection_matches_per_action_full_check(seed):
    old = run_with(native_adapter, legacy_collect, lambda: native_run(seed))
    assert bitwise(old) == bitwise(native_run(seed))


def test_debug_interval_full_checks_leave_records_unchanged(monkeypatch):
    calls = []
    check = Engine.check_conservation
    monkeypatch.setattr(Engine, 'check_conservation', lambda self: calls.append(1) or check(self))
    monkeypatch.setattr(native_adapter, 'FULL_CHECK_EVERY', 0)
    plain = adaptive_run()
    assert len(calls) == 2*len(plain.paths)  # per path: end of the replay and the final native state
    calls.clear()
    monkeypatch.setattr(native_adapter, 'FULL_CHECK_EVERY', 1)
    checked = adaptive_run()
    assert len(calls) > 2*len(plain.paths)
    assert bitwise(checked) == bitwise(plain)


def corrupt_balances(item):
    item[6][0, 1] += 1e24


def corrupt_row(item):
    item[4][B] += 1e6


def corrupt_claim(item):
    item[8][int(item[4][DEBT]), 0] += 1e6


@pytest.mark.parametrize('corrupt', [corrupt_balances, corrupt_row, corrupt_claim])
def test_injected_violation_is_caught_at_its_logged_action(corrupt):
    """Every injection is also caught by the legacy per-action check, at the same action."""
    seen = {}

    def inject(target):
        def collect(path, e, initial, grid, horizon, holders, logs, cfg):
            opens = [k for k, item in enumerate(logs) if item[0] == 1 and item[4][ACTIVE]]
            k = opens[len(opens)//2]
            corrupt(logs[k])
            seen['k'] = k
            return target(path, e, initial, grid, horizon, holders, logs, cfg)
        return collect
    with pytest.raises(AssertionError, match='conservation error'):
        run_with(adaptive_adapter, inject(legacy_collect), adaptive_run)
    with pytest.raises(AssertionError, match=f"at logged action {seen['k']}$"):
        run_with(adaptive_adapter, inject(native_adapter.collect), adaptive_run)
