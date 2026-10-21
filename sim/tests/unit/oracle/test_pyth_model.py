import numpy as np
import pytest
from chrono_sim.market.gbm import generate
from chrono_sim.oracle import OracleConfig, OracleModel


def batch():
    b = generate(dict(mu=0., sigma=0., conf_c0=.01), 2, 180, 1, np.random.default_rng(1))
    b.log_price[:, :, 13:] = np.log(1.02)
    b.bar_low[:] = b.log_price
    return b


def test_cadence_deviation_heartbeat_and_arrays():
    b = batch()
    o = OracleModel(b, OracleConfig(cadence_s=.4), np.random.default_rng(2))
    assert o.stored(0, 'HBAR', 13.) == pytest.approx((1., .01, 0.))
    assert o.stored(0, 'HBAR', 13.2) == pytest.approx((1.02, .0102, 13.2))
    assert o.stored(0, 'HBAR', 73.2) == pytest.approx((1.02, .0102, 73.2))
    arrays = o.arrays()
    for path in range(2):
        for k in (0, 13, 14, 74, 180):
            np.testing.assert_allclose([a[path, 0, k] for a in arrays], o.stored(path, 'HBAR', b.t[k]))


def test_unavailable_keeper_preserves_stale_quote():
    o = OracleModel(batch(), OracleConfig(keeper_uptime=0.), np.random.default_rng(2))
    assert o.stored(0, 'HBAR', 180) == (1., .01, 0.)
    assert 0+o.cfg.staleness_s < 180  # caller, not oracle, rejects stale reads
    with pytest.raises(ValueError):
        o.stored(0, 'HBAR', -1)


def test_outages_reproducible_and_no_future_leakage():
    b = batch()
    cfg = OracleConfig(keeper_uptime=.5, outage_mean_s=10)
    a = OracleModel(b, cfg, np.random.default_rng(6)).arrays()
    z = OracleModel(b, cfg, np.random.default_rng(6)).arrays()
    for x, y in zip(a, z):
        np.testing.assert_array_equal(x, y)
    assert np.all(a[2] <= b.t)
    assert np.all(np.diff(a[2], axis=2) >= 0)
