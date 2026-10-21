"""P3c regression tests for the two legacy engine limitations preserved by P3b."""
import numpy as np
import pytest
from chrono_sim.engine import EventLoop, LoopConfig, Holder, CapRoller
from chrono_sim.engine.refine import refined_path
from chrono_sim.market.pathbatch import PathBatch
from chrono_sim.models import REGISTRY
from chrono_sim.models.config import load_pair
from chrono_sim.protocol.ref.switches import Switches


def jump_batch(diffusion=True):
    """Zero diffusion, downward jump at a bar end; pre-jump path and diffusion minimum stay at 2."""
    t = np.array([0., 60., 120., 9000.])
    p = np.log(np.array([[[2., 2., 1.5, 1.5], [1., 1., 1., 1.]]]))
    pre = p.copy()
    pre[0, 0, 2] = np.log(2.)
    mask = np.zeros_like(p, bool)
    mask[0, 0, 2] = True
    dlow = pre.copy()
    low = np.minimum(dlow, p)
    return PathBatch(t, ('HBAR', 'USDC'), p, low, np.zeros_like(p), mask,
                     np.zeros((1, len(t)), np.int8), {}, pre, dlow if diffusion else None)


@pytest.mark.parametrize('diffusion', [True, False])
def test_zero_diffusion_jump_bridge_uses_pre_jump_endpoint(diffusion):
    fine = refined_path(jump_batch(diffusion), 0, {2}, (0., 0.), np.random.default_rng(5))
    inside = (fine.t > 60) & (fine.t < 120)
    assert np.allclose(fine.log_price[0, 0, inside], np.log(2.))
    assert fine.log_price[0, 0, fine.t == 120.].item() == np.log(1.5)


def test_moving_jump_bridge_minimum_is_the_diffusion_minimum():
    b = jump_batch()
    dlow = b.diffusion_low.copy()
    dlow[0, 0, 2] = np.log(1.9)
    low = np.minimum(dlow, b.log_price)
    from dataclasses import replace
    b = replace(b, diffusion_low=dlow, bar_low=low)
    fine = refined_path(b, 0, {2}, (.001, 0.), np.random.default_rng(5))
    inside = (fine.t > 60) & (fine.t < 120)
    assert fine.log_price[0, 0, inside].min() == pytest.approx(np.log(1.9), abs=1e-15)


@pytest.mark.parametrize('native', [False, True])
def test_engine_runs_zero_diffusion_jump_bar(native):
    pair = load_pair('B0_cap', 'HBAR_USDC')
    loop = EventLoop(REGISTRY['B0_cap'](), {('HBAR', 'USDC'): pair}, Switches.m0(),
                     LoopConfig(native=native, sigma_per_s=(0., 0.)))
    r = loop.run(jump_batch(), [Holder('HBAR', 'USDC', u=.99)], np.random.default_rng(3))
    assert r.paths['conservation_error'].max() <= 1e-9


def crash_market():
    t = np.array([0., 60., 7140., 7200., 30000.])
    p = np.log(np.array([[[2., .2, .2, .2, .2], [1.]*5]]))
    return PathBatch(t, ('HBAR', 'USDC'), p, p.copy(), np.zeros_like(p), np.zeros_like(p, bool),
                     np.zeros((1, len(t)), np.int8), {})


@pytest.mark.parametrize('native', [False, True])
def test_exhausted_roller_stops_rolling_and_records_reason(native):
    pair = load_pair('B0_cap', 'HBAR_USDC')
    loop = EventLoop(REGISTRY['B0_cap'](), {('HBAR', 'USDC'): pair}, Switches.m0(),
                     LoopConfig(native=native, sigma_per_s=(0., 0.), sp_deposit=1e5))
    r = loop.run(crash_market(), [CapRoller('HBAR', 'USDC')], np.random.default_rng(3))
    rows = r.positions
    assert len(rows) == 1
    assert rows['stop_reason'].to_list() == ['collateral_exhausted']
    assert r.paths['conservation_error'].max() <= 1e-9
