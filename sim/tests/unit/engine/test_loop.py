"""Real I1-I4 end-to-end holder, keeper, scheduler and Parquet boundary."""
from dataclasses import replace
import numpy as np
import pytest
from chrono_sim.market.gbm import generate
from chrono_sim.market.pathbatch import PathBatch
from chrono_sim.models import REGISTRY
from chrono_sim.models.config import load_pair
from chrono_sim.protocol.ref.switches import Switches
from chrono_sim.engine import EventLoop, LoopConfig, Holder, Keeper, CapRoller, PathRecords
from chrono_sim.engine.heap import LiquidationHeap


def market(prices=(2., 2., 2.), times=(0., 3600., 7200.)):
    p = np.array([[prices, np.ones(len(prices))]], dtype=float)
    return PathBatch(np.array(times, dtype=float), ('HBAR', 'USDC'), np.log(p), np.log(p),
                     np.zeros_like(p), np.zeros_like(p, bool), np.zeros((1, len(prices)), np.int8), {})


def loop(**kwargs):
    pair = load_pair('B0_cap', 'HBAR_USDC')
    cfg = LoopConfig(sigma_per_s=(0., 0.), **kwargs)
    return EventLoop(REGISTRY['B0_cap'](), {('HBAR', 'USDC'): pair}, Switches.m0(), cfg)


def test_holder_repay_records_and_parquet(tmp_path):
    e = loop()
    b = generate(dict(assets=('HBAR', 'USDC'), initial_price=[2., 1.], sigma=[0., 0.]), 1, 7200, 60, np.random.default_rng(2))
    r = e.run(b, [Holder('HBAR', 'USDC')], np.random.default_rng(1))
    assert r.positions['outcome'].to_list() == ['repaid']
    assert r.positions['debt_time_integral'].item() > 0
    assert e.stats['skipped_bars'] == 120
    r.write(tmp_path)
    assert PathRecords.read(tmp_path).positions.equals(r.positions)


def test_real_gbm_reproducibility_and_batch_size():
    b = generate(dict(assets=('HBAR', 'USDC'), initial_price=[2., 1.], sigma=[0., 0.]), 2, 9000, 60, np.random.default_rng(2))
    h = [Holder('HBAR', 'USDC', rho_miss=1)]
    a, c = loop().run(b, h, np.random.default_rng(9)), loop().run(b, h, np.random.default_rng(9))
    assert a.positions.equals(c.positions)
    assert a.positions['hard_reserve'].sum() == 2
    assert a.paths['conservation_error'].max() <= 1e-9


def test_keeper_liquidates_crash_and_sp_routes():
    b = market((2., .5, .5), (0., 60., 9000.))
    e = loop(sp_deposit=1e5)
    r = e.run(b, [Holder('HBAR', 'USDC', rho_miss=1)], np.random.default_rng(3))
    assert r.positions['soft_sp'].sum() > 0
    assert r.positions['first_liquidation_at'].item() < 7200


def test_hss_capacity_rejects_seventh_same_second():
    e = loop(hss_capacity=1)
    r = e.run(market(), [Holder('HBAR', 'USDC')]*7, np.random.default_rng(4))
    assert len(r.positions) == 6
    assert e.stats['reverts'] >= 1


def test_heap_updates_discard_stale_entries():
    h = LiquidationHeap()
    h.update(('a', 'b'), 1, 10)
    h.update(('a', 'b'), 1, 3)
    h.update(('a', 'b'), 2, 4)
    assert h.top(('a', 'b')) == (4, 2)
    h.discard(('a', 'b'), 2)
    assert h.top(('a', 'b')) == (3, 1)


def test_cap_roller_reopens_after_repay():
    e = loop()
    r = e.run(market((2., 2., 2., 2.), (0., 3600., 7200., 15000.)),
              [CapRoller('HBAR', 'USDC')], np.random.default_rng(3))
    assert len(r.positions) >= 2
    assert r.positions['strategy'].unique().to_list() == ['roller']


def test_scheduled_noop_after_repay_does_not_record_liquidation():
    r = loop().run(market((2., 2., 2.), (0., 60., 9000.)), [Holder('HBAR', 'USDC')], np.random.default_rng(8))
    assert r.positions['outcome'].to_list() == ['repaid']
    assert r.positions['hard_reserve'].sum() == 0
    assert r.positions['first_liquidation_at'].item() == -1


def test_keeper_can_execute_before_delayed_hss():
    e = loop(hss_delay_s=1000.)
    r = e.run(market((2., 2., 2.), (0., 60., 9000.)),
              [Holder('HBAR', 'USDC', rho_miss=1.)], np.random.default_rng(8))
    assert r.positions['first_liquidation_at'].item() == 8101.
    assert r.positions['hard_reserve'].item() == 1


def test_refinement_common_random_numbers_survive_different_active_windows():
    from chrono_sim.engine.refine import refined_path
    b = market((2., 2., 2.), (0., 60., 120.))
    lows = b.bar_low.copy()
    lows[0, 0, 1:] -= .1
    b = replace(b, bar_low=lows)
    a = refined_path(b, 0, {1, 2}, (.01, 0.), np.random.default_rng(17))
    c = refined_path(b, 0, {2}, (.01, 0.), np.random.default_rng(17))
    assert np.array_equal(a.log_price[:, :, a.t >= 60], c.log_price[:, :, c.t >= 60])


def test_batch_loop_normalises_mixed_token_decimals():
    b = generate(dict(assets=('HBAR', 'USDC'), initial_price=[2., 1.], sigma=[0., 0.]),
                 1, 7200., 60., np.random.default_rng(2))
    e = loop(token_decimals={'HBAR': 8, 'USDC': 6})
    r = e.run(b, [Holder('HBAR', 'USDC')], np.random.default_rng(1))
    assert r.positions['open_ltv'].item() == pytest.approx(.8*.85, abs=1e-5)
    assert r.positions['outcome'].to_list() == ['repaid']
