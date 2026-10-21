"""P3c keyed streams, exact coarse paths and nested conditional refinement."""
import numpy as np
import pytest
from chrono_sim.market.coarse import AdaptiveMarket, coarse_path
from chrono_sim.market.gbm import GBMParams
from chrono_sim.market.jumpdiff import KouParams
from chrono_sim.market.keyed import stream, uniform, normal
from chrono_sim.market.nested import refine_segment, refine_piece, truncated_min, bessel_nodes, lattice


def test_keyed_streams_are_reproducible_and_distinct():
    a, b, c = stream(7, 0, 3, 1, 2), stream(7, 0, 3, 1, 2), stream(7, 0, 3, 1, 3)
    x = [uniform(a) for _ in range(5)]
    assert x == [uniform(b) for _ in range(5)]
    assert x != [uniform(c) for _ in range(5)]
    assert all(0 < u < 1 for u in x)
    assert np.isfinite(normal(a))


def kou(**update):
    base = dict(assets=('HBAR', 'USDC'), initial_price=[2., 1.], sigma=[.6, 0.], jump_rate=[400., 0.])
    return KouParams.model_validate(base | update)


def test_coarse_path_knots_jumps_and_extremes():
    m = AdaptiveMarket(kou(), 1, 30*86400.)
    p = m.path(11, [1., -1.])
    assert np.array_equal(p.t0[1:], p.t1[:-1]) and p.t0[0] == 0 and p.t1[-1] == m.horizon_s
    assert set(np.arange(0., m.horizon_s, 3600.)) <= set(p.t0)
    assert len(p.jump_t) > 0 and set(p.jump_t) <= set(p.t1)
    for t, a in zip(p.jump_t, p.jump_a):
        g = np.searchsorted(p.t1, t)
        assert p.x0[a, g+1] != p.x1[a, g]
    assert np.all(p.zmin[0] <= np.minimum(p.x0[0], p.x1[0]))
    assert np.all(p.x0[1] == 0.) and np.all(p.zmin[1] == 0.)
    q = m.path(11, [1., -1.])
    assert all(np.array_equal(x, y) for x, y in zip(p, q))
    assert np.all(p.iv_zmin[0] <= p.x0[0, p.iv_first])


def test_debt_role_extreme_is_a_maximum():
    m = AdaptiveMarket(GBMParams.model_validate(dict(assets=('A', 'B'), sigma=[.5, .5])), 1, 86400.)
    p = m.path(3, [1., -1.])
    assert np.all(-p.zmin[1] >= np.maximum(p.x0[1], p.x1[1]))


def test_zero_diffusion_jump_segments_are_linear_without_error():
    m = AdaptiveMarket(kou(sigma=[0., 0.], jump_rate=[2000., 0.]), 1, 86400.)
    p = m.path(5, [1., -1.])
    nodes, values, pm, tau, owner = refine_segment(5, 0, 0, p.t0[0], p.t1[0], p.x0[0, 0], p.x1[0, 0],
                                                   p.zmin[0, 0], 0., 60.)
    assert values[0] == p.x0[0, 0] and values[-1] == p.x1[0, 0] and owner == -1
    assert np.allclose(np.diff(values, 2), 0., atol=1e-15) and np.allclose(pm, np.minimum(values[:-1], values[1:]))


@pytest.mark.parametrize('seed', range(6))
def test_segment_refinement_respects_minimum_and_endpoints(seed):
    rng = np.random.default_rng(seed)
    z0, z1, sigma, t0, t1 = 0., rng.normal(0, .01), .0002, 3600.*seed+17.5, 3600.*(seed+1)
    zmin = (z0+z1-np.sqrt((z1-z0)**2-2*sigma**2*(t1-t0)*np.log(rng.random())))/2
    nodes, values, pm, tau, owner = refine_segment(9, 0, seed, t0, t1, z0, z1, zmin, sigma, 60.)
    assert np.array_equal(nodes, lattice(t0, t1, 60.)) and nodes[1] == 3600.*seed+60
    assert values[0] == z0 and values[-1] == z1 and np.all(values >= zmin)
    assert owner >= 0 and pm[owner] == zmin and nodes[owner] < tau < nodes[owner+1]
    assert np.all(pm >= zmin) and np.all(pm <= np.minimum(values[:-1], values[1:]))
    again = refine_segment(9, 0, seed, t0, t1, z0, z1, zmin, sigma, 60.)
    assert np.array_equal(values, again[1]) and np.array_equal(pm, again[2])
    i = (owner+1) % (len(nodes)-1)
    fine_nodes, fine = refine_piece(9, 0, seed, i, nodes[i], nodes[i+1], values[i], values[i+1], pm[i], -1., sigma)
    assert fine[0] == values[i] and fine[-1] == values[i+1] and np.all(fine >= pm[i])
    fine_nodes, fine = refine_piece(9, 0, seed, owner, nodes[owner], nodes[owner+1], values[owner],
                                    values[owner+1], zmin, tau, sigma)
    assert np.all(fine >= zmin)
    with_tau = np.sort(np.r_[fine_nodes, tau])
    exact = bessel_nodes(with_tau, values[owner], values[owner+1], zmin, tau-nodes[owner], sigma, stream(1, 0, 0, 0, 0))
    assert exact[np.searchsorted(with_tau, tau)] == zmin


def test_truncated_minimum_bounds():
    for u in (1e-12, .3, .999999):
        m = truncated_min(.01, .02, -.005, 1e-5, u)
        assert -.005 <= m <= .01
    assert truncated_min(.01, .02, .015, 1e-5, .5) == .01
    assert truncated_min(.01, .02, .01, 1e-5, .5) == .01


def test_market_rejects_realised_volatility_confidence():
    with pytest.raises(ValueError, match='base-grid'):
        AdaptiveMarket(kou(conf_c1=.1), 1, 3600.)
    assert coarse_path is not None
