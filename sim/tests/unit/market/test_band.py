"""T1 (P3C_ORACLE_SAMPLER_DESIGN.md section 9): closed forms of the exact two-sided band sampler.

Each closed form is checked against an independent derivation (eigenfunction series of the killed
heat kernel, quadrature of the bridge first-passage density) and against small Monte Carlo runs;
the kernel edge cases are checked directly. Runs in seconds with NUMBA_DISABLE_JIT=1.
"""
import math
import numpy as np
import pytest
from scipy import integrate, stats
from chrono_sim.market import band
from chrono_sim.market.keyed import stream

W = math.log1p(.005)-math.log1p(-.005)


def sine_stay(a, b, w, v, terms=4000):
    """P(bridge from a to b, variance v, stays in (0, w)) from the Fourier sine expansion of the killed kernel."""
    n = np.arange(1, terms+1)
    q = 2/w*np.sum(np.sin(n*np.pi*a/w)*np.sin(n*np.pi*b/w)*np.exp(-n**2*np.pi**2*v/(2*w*w)))
    return q/(math.exp(-(b-a)**2/(2*v))/math.sqrt(2*math.pi*v))


@pytest.mark.parametrize('ratio', [.08, .3, 1., 4.])
@pytest.mark.parametrize('a,b', [(.5, .5), (.2, .7), (.05, .9), (.93, .4)])
def test_exit_probability_matches_the_eigenfunction_series(ratio, a, b):
    v = ratio*W*W
    pe = band.exit_prob(a*W, b*W, W, v)
    assert pe == pytest.approx(1-sine_stay(a*W, b*W, W, v), abs=1e-9)
    p_hi, p_lo = band.hit_prob((1-a)*W, (1-b)*W, v), band.hit_prob(a*W, b*W, v)
    assert max(p_hi, p_lo)-1e-15 <= pe <= p_hi+p_lo+1e-15


def test_small_exit_probabilities_keep_relative_precision():
    # At sigma 0.6 per year over 60 s the window variance is w^2/146: the union bound is the answer to ~1e-60.
    v = W*W/146
    pe = band.exit_prob(.5*W, .52*W, W, v)
    p_hi, p_lo = band.hit_prob(.5*W, .48*W, v), band.hit_prob(.5*W, .52*W, v)
    assert 0 < pe and pe == pytest.approx(p_hi+p_lo, rel=1e-12)


def test_wide_band_reduces_to_the_one_sided_hitting_probability():
    v = .3*W*W
    wide = 400*W
    assert band.exit_prob(wide-.3*W, wide-.1*W, wide, v) == pytest.approx(band.hit_prob(.3*W, .1*W, v), rel=1e-12)


def test_exit_probability_integrates_to_the_free_strip_survival():
    # Quadrature of the killed density over the end value against the sine series of free-BM survival.
    a, v = .35*W, .5*W*W
    pdf = lambda b: math.exp(-(b-a)**2/(2*v))/math.sqrt(2*math.pi*v)
    stay, _ = integrate.quad(lambda b: (1-band.exit_prob(a, b, W, v))*pdf(b), 0., W, limit=200)
    n = np.arange(1, 4001, 2)
    survival = np.sum(4/(n*np.pi)*np.sin(n*np.pi*a/W)*np.exp(-n**2*np.pi**2*v/(2*W*W)))
    assert stay == pytest.approx(survival, abs=1e-10)


def test_exit_probability_against_a_fine_grid_bridge():
    rng = np.random.default_rng(3)
    a, b, v, steps, n = .4*W, .6*W, .6*W*W, 400, 4000
    t = np.linspace(0, 1, steps+1)
    walk = np.cumsum(np.c_[np.zeros(n), rng.standard_normal((n, steps))*math.sqrt(v/steps)], axis=1)
    path = a+walk-t*(walk[:, -1:]-(b-a))
    d = v/steps
    lo, hi = path[:, :-1], path[:, 1:]
    # Exact per-step crossing probabilities of each level (two-sided double counting is O(step^2)).
    p = np.exp(-2*np.clip(W-lo, 0, None)*np.clip(W-hi, 0, None)/d)+np.exp(-2*np.clip(lo, 0, None)*np.clip(hi, 0, None)/d)
    stay = np.prod(np.clip(1-p, 0, 1), axis=1)*np.all((path > 0) & (path < W), axis=1)
    estimate, se = 1-stay.mean(), stay.std()/math.sqrt(n)
    assert abs(estimate-band.exit_prob(a, b, W, v)) < 4*se+2e-3


def bridge_hit_cdf(delta, eps, v, x):
    """CDF on (0, 1) of the hit time fraction of a level at distance delta, end at signed distance eps."""
    def density(f):
        return delta/f*np.exp(-delta**2/(2*v*f)-eps**2/(2*v*(1-f))+(delta-eps)**2/(2*v))/np.sqrt(2*np.pi*v*f*(1-f))
    total = integrate.quad(density, 0, 1, limit=400)[0]
    return np.array([integrate.quad(density, 0, y, limit=400)[0]/total for y in x])


@pytest.mark.parametrize('delta,eps', [(.5, .3), (.2, .9), (.6, -.2)])
def test_hitting_time_given_a_hit_is_inverse_gaussian_in_r(delta, eps):
    v, n = .4*W*W, 3000
    st = stream(11, 0, 0, band.LEVEL_BAND, 0)
    fractions = np.empty(n)
    for i in range(n):
        fractions[i] = band.hit_time(0., 1., delta*W, eps*W, v, st)
    grid = np.linspace(.001, .999, 60)
    cdf = bridge_hit_cdf(delta*W, eps*W, v, grid)
    result = stats.kstest(fractions, lambda x: np.interp(x, grid, cdf))
    assert result.pvalue > .001


def strip_ratio(delta, w, vt, terms=4000):
    """First-passage density to 0 before w over the free one: sine-series derivative of the killed kernel."""
    n = np.arange(1, terms+1)
    strip = np.pi/(w*w)*np.sum(n*np.sin(n*np.pi*delta/w)*np.exp(-n**2*np.pi**2*vt/(2*w*w)))
    free = delta/math.sqrt(2*math.pi*vt**3)*math.exp(-delta**2/(2*vt))
    return strip/free


@pytest.mark.parametrize('delta', [.05, .3, .5, .9])
@pytest.mark.parametrize('ratio', [.1, .5, 2.])
def test_thinning_probability_matches_the_strip_first_passage_ratio(delta, ratio):
    vt = ratio*W*W
    alpha = band.exit_accept(delta*W, W, vt)
    assert 0 <= alpha <= 1+1e-15
    assert alpha == pytest.approx(strip_ratio(delta*W, W, vt), abs=1e-8)


def test_thinning_probability_is_stable_near_the_level_and_at_zero_time():
    vt = .4*W*W
    limit = band.exit_accept(1e-300, W, vt)
    assert math.isfinite(limit) and limit == pytest.approx(band.exit_accept(1e-7*W, W, vt), rel=1e-6)
    assert band.exit_accept(.5*W, W, 0.) == 1.


def test_thinning_probability_against_monte_carlo_of_bessel3_bridges():
    # The pre-hit path measured from the hit level is a Bessel(3) bridge from delta to 0.
    rng = np.random.default_rng(5)
    delta, vt, steps, n = .3*W, .5*W*W, 2000, 4000
    t = np.linspace(0, 1, steps+1)
    walk = np.cumsum(np.concatenate((np.zeros((n, 1, 3)), rng.standard_normal((n, steps, 3))*math.sqrt(vt/steps)), axis=1), axis=1)
    bridge = walk-t[None, :, None]*walk[:, -1:, :]
    bridge[:, :, 0] += delta*(1-t)
    stay = (np.linalg.norm(bridge, axis=2).max(axis=1) < W).mean()
    # A grid maximum misses excursions between nodes, which biases the estimate upwards by O(sqrt(step)).
    assert -4*math.sqrt(stay*(1-stay)/n) < stay-band.exit_accept(delta, W, vt) < 4*math.sqrt(stay*(1-stay)/n)+.02


def one(iv):
    return np.asarray(iv, np.int64).reshape(-1, 2)


def run(ta, xa, tb, xb, s2, iv=((1, 60),), key=0, dev=.005):
    out, trace, tn, counts = np.zeros(1), np.zeros((1, 256, 2)), np.zeros(1, np.int64), np.zeros(3, np.int64)
    ivs = one(iv)
    s = band.first_exit(ta, xa, tb, xb, 0., 1., dev, s2, ivs, len(ivs), stream(key, 0, 0, band.LEVEL_BAND, 0),
                        out, trace, tn, 0, counts, 0)
    return s, out[0], trace[0, :tn[0]], counts


def test_quiet_window_is_skipped_with_one_uniform():
    s, _, trace, counts = run(0., 0., 60., .001, (.6/math.sqrt(31536000))**2)
    assert s == -1 and len(trace) == 0 and counts[1] == 0


def test_end_beyond_a_level_forces_an_exit_before_the_end():
    hi = math.log1p(.005)
    s, x, _, counts = run(0., 0., 60.5, hi+.004, (.01/math.sqrt(60))**2, key=2)
    assert counts[1] >= 1
    assert s == -1 or (1 <= s <= 60 and abs(math.expm1(x)) >= .005)


def test_end_exactly_on_a_level_exits_at_or_before_the_end():
    hi = math.log1p(.005)
    for key in range(20):
        s, x, _, _ = run(0., 0., 60., hi, (.004/math.sqrt(60))**2, key=key)
        assert s == -1 or abs(math.expm1(x)) >= .005


def test_start_next_to_a_level_samples_an_immediate_exit():
    hi = math.log1p(.005)
    s, x, trace, _ = run(0., hi*(1-1e-13), 60., 0., (.003/math.sqrt(60))**2, key=4)
    assert len(trace) >= 1 and trace[0, 0] < 1.
    assert s == -1 or abs(math.expm1(x)) >= .005


def test_exit_in_the_last_second_reveals_nothing_after_it():
    # Every exit time lies in (59, 60): no integer second follows it before the end node.
    hi = math.log1p(.005)
    for key in range(30):
        s, _, trace, _ = run(59., 0., 60., hi+.002, (.003/math.sqrt(60))**2, key=key)
        assert s == -1 and all(t < 60 for t in trace[:, 0])


def test_unmonitored_end_is_never_reported():
    hi = math.log1p(.005)
    for key in range(30):
        s, _, _, _ = run(0., 0., 60., hi+.01, (.02/math.sqrt(60))**2, iv=((1, 59),), key=key)
        assert s <= 59


def test_start_outside_the_band_walks_forward_second_by_second():
    hi = math.log1p(.005)
    s, x, trace, counts = run(.3, hi+.003, 60., hi+.003, (.0001)**2, key=1)
    assert s == 1 and x > hi and counts[2] == 1 and trace[0, 0] == 1.


def test_outage_seconds_are_not_monitored():
    hi = math.log1p(.005)
    for key in range(30):
        s, _, _, _ = run(0., 0., 60., hi+.01, (.02/math.sqrt(60))**2, iv=((1, 9), (40, 60)), key=key)
        assert s == -1 or 1 <= s <= 9 or 40 <= s <= 60


def test_no_monitored_second_draws_nothing():
    s, _, trace, counts = run(0., 0., 60., .1, 1e-4, iv=((70, 80),))
    assert s == -1 and len(trace) == 0 and counts.sum() == 0


def test_zero_volatility_walks_the_linear_path():
    s, x, _, _ = run(0., 0., 60., .006, 0.)
    expected = next(k for k in range(1, 61) if abs(math.expm1(.006*k/60)) >= .005)
    assert s == expected and x == pytest.approx(.006*expected/60, rel=1e-12)


def test_equal_streams_give_equal_results():
    args = (0., 0., 60., .002, (.006/math.sqrt(60))**2)
    assert all(run(*args, key=k)[:2] == run(*args, key=k)[:2] for k in range(10))
