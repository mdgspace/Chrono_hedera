import numpy as np
import pytest
from chrono_sim.market.intrabar import refine_bar, refine_bar_nb, refine_bar_with_clock


@pytest.mark.parametrize('p0,p1,low', [(0., .1, -.2), (0., 0., 0.), (0., .1, 0.), (.1, 0., 0.)])
def test_endpoints_minimum_and_numba(p0, p1, low):
    a = refine_bar(p0, p1, low, .02, 60., 1., np.random.default_rng(8))
    b = refine_bar_nb(p0, p1, low, .02, 60., 1., 8)
    for p in (a, b):
        assert len(p) == 61
        assert p[0] == p0 and p[-1] == p1 and p.min() == low
    np.testing.assert_array_equal(b, refine_bar_nb(p0, p1, low, .02, 60., 1., 8))
    t, p = refine_bar_with_clock(p0, p1, low, .02, 60., 1., np.random.default_rng(8))
    assert p.min() == low and np.all(np.diff(t) > 0)
    assert p[0] == p0 and p[-1] == p1


def test_impossible_bars_rejected():
    for low, sigma, step in [(.1, .1, 1), (-.1, 0., 1), (-.1, .1, 60)]:
        with pytest.raises(ValueError):
            refine_bar(0., 0., low, sigma, 60, step, np.random.default_rng(1))
