"""Array cores of the relink chain against frozen copies of the NamedTuple kernels they replaced.

The fast-forward calls the cores on the arrays they read, so no call passes the State, Runtime or View
NamedTuples (P3C_ENGINE_REPORT.md, exact call-boundary reductions). The references below are the kernels as
they were at source a54f636a69923e84, statement for statement; a core must return the same value or raise
the same exception on every input.
"""
import math
import numpy as np
import pytest
from numba import njit
from chrono_sim.engine import EventLoop, LoopConfig, Holder, Keeper
from chrono_sim.engine import adaptive_loop as al, native_actions as na
from chrono_sim.engine.adaptive_adapter import stub
from chrono_sim.engine.native_adapter import inputs
from chrono_sim.market.coarse import AdaptiveMarket
from chrono_sim.market.jumpdiff import KouParams
from chrono_sim.models import REGISTRY
from chrono_sim.models.config import load_pair
from chrono_sim.protocol.fast import vault, pools, liquidation
from chrono_sim.protocol.fast.math import WAD, YEAR, MAX, checked, wm, wd, ltv, kink
from chrono_sim.protocol.fast.state import C, B, START, TERM, ACTIVE, COLL, DEBT, PRINCIPAL, ACCRUED, LAST
from chrono_sim.protocol.ref.switches import Switches


@njit
def ref_price(s, token):
    p = s.prices[token]
    if s.meta[2]:
        return p[0]
    if checked(p[3]+120) < s.meta[0]:
        raise ValueError(10)
    if p[0] < 0:
        raise ValueError(11)
    expo = p[2]
    if expo == -(2**31) or abs(expo+18) > 77:
        raise ValueError(1)
    return checked(p[0]*10.0**(18+expo)) if expo >= -18 else np.floor(p[0]/10.0**(-expo-18))


@njit
def ref_risk_prices(s, coll, debt, opening=False):
    pc, pd = ref_price(s, coll), ref_price(s, debt)
    if not s.switches[5]:
        return pc, pd
    cc = s.prices[coll, 1]*10.0**(18+s.prices[coll, 2])
    cd = s.prices[debt, 1]*10.0**(18+s.prices[debt, 2])
    if opening and (cc > s.meta[8]*pc or cd > s.meta[8]*pd):
        raise ValueError(12)
    return max(0.0, pc-s.meta[7]*cc), pd+s.meta[7]*cd


@njit
def ref_value(s, token, amount, p):
    return np.floor(amount*p/10.0**s.cfg[token, 14]) if s.switches[2] else wm(amount, p)


@njit
def ref_apy(s, token):
    return kink(s.cfg[token, 15], s.lp[token, 0], s.lp[token, 0]+s.balances[token, -4])


@njit
def ref_health(s, i, total, pc, pd, threshold_nb):
    p = s.positions[i]
    coll, debt = int(p[COLL]), int(p[DEBT])
    if s.switches[5]:
        pc, pd = ref_risk_prices(s, coll, debt)
    dv = ref_value(s, debt, total, pd)
    if dv == 0:
        return MAX
    remaining = max(0.0, p[START]+p[TERM]-s.meta[0])
    elapsed = checked(s.meta[0]-p[START])
    if s.switches[3] and not s.switches[0]:
        ltv(s.cfg[coll], remaining)
    if s.switches[3]:
        lt = threshold_nb(s.params[i], remaining, elapsed)*WAD
    elif s.switches[0]:
        lt = s.meta[9]*WAD
    else:
        cfg = s.cfg[coll]
        buf = cfg[5]+wm(cfg[6]-cfg[5], WAD-np.floor(WAD*math.exp(-cfg[7]*elapsed/WAD)))
        lt = min(checked(ltv(cfg, remaining)+buf), WAD)
    return wd(wm(ref_value(s, coll, p[C], pc), lt), dv)


@njit
def ref_eligible(s, i, threshold_nb):
    p = s.positions[i]
    d, c = int(p[DEBT]), int(p[COLL])
    rate = ref_apy(s, d)/WAD/YEAR
    accrued = (p[PRINCIPAL]+p[ACCRUED])*math.expm1(rate*max(0., s.meta[0]-p[LAST]))
    total = p[PRINCIPAL]+p[ACCRUED]+accrued if s.switches[1] else p[B]+accrued
    result = False
    try:
        result = ref_health(s, i, total, ref_price(s, c), ref_price(s, d), threshold_nb) <= WAD
    except Exception:
        pass
    return result


@njit
def ref_relinks(s, r, i, t, threshold_nb, tight, rates):
    p, base = s.positions[i], r.settings[1]
    c, d = int(p[COLL]), int(p[DEBT])
    if tight[c, d] <= 0 or r.book_locations[i] < 0:
        return False
    try:
        ratio = ref_price(s, c)/ref_price(s, d)
    except Exception:
        return False
    if not ratio <= al.bound(tight[c, d], rates[d], t) or not ratio <= al.barrier_at(r.barriers[i], t):
        return False
    if not ratio <= al.bound(r.barriers[i]*math.exp((al.G-rates[d])*(p[LAST]-base)), rates[d], t):
        return False
    if not p[ACTIVE] or r.pending[i]:
        return False
    return ref_eligible(s, i, threshold_nb)


def outcome(f, *args):
    try:
        return f(*args)
    except Exception as exc:
        return type(exc).__name__, exc.args


def same(a, b):
    return a == b or (isinstance(a, float) and isinstance(b, float) and math.isnan(a) and math.isnan(b))


def fixture(model, m0):
    """A State, Runtime and threshold kernel as the adaptive adapter builds them, with the model's kernel params."""
    switches = Switches.m0() if m0 else Switches()
    pairs = {('HBAR', 'USDC'): load_pair(model, 'HBAR_USDC')} if m0 else {}
    loop = EventLoop(REGISTRY[model](), pairs, switches, LoopConfig(adaptive=True, hss_capacity=2000, sp_deposit=300.),
                     Keeper(1.))
    kou = KouParams.model_validate(dict(assets=('HBAR', 'USDC'), initial_price=[2., 1.], sigma=[2., 0.],
                                        jump_rate=[0., 0.], eta_down=8.))
    holders = [Holder('HBAR', 'USDC', term_s=7200., u=.95)]
    e = loop.make_engine(stub(AdaptiveMarket(kou, 1, 3600.)), holders)
    loop.max_conf = .02  # set by the adapter from the market; the relink chain does not read it
    data, draws, rows, _, settings = inputs(loop, e, holders, np.random.default_rng(0), 3600.)
    e.state.params[:] = rows[0]
    return e.state, al.runtime(e.state, data, draws, settings), e.threshold_nb


def scramble(s, r, rng, tight, rates):
    """Random position, prices, clock, pools and switches: stale and negative prices, exponent extremes,
    C == 0 and C > 0, remaining duration below, inside and above [cfg[12], cfg[13]]. Returns (i, t)."""
    clock = s.meta[0] = float(r.settings[1]+rng.integers(0, 10**7))
    s.meta[2] = rng.random() < .05
    s.meta[7], s.meta[8], s.meta[9] = rng.uniform(0., 2.), rng.uniform(0., .05), rng.uniform(.5, 1.)
    for k in (0, 1, 2, 5):
        s.switches[k] = rng.random() < .5
    for token in range(2):
        extreme = rng.choice([-18., -19., 0., 59., 60., -95., -96., -2.**31, float(rng.integers(-100, 80))])
        expo = extreme if rng.random() < .3 else -8.
        size = 10**rng.uniform(-3., 15.)
        stamp = -1e9 if rng.random() < .02 else clock-rng.uniform(-60., 140.)
        s.prices[token] = -size if rng.random() < .05 else size, size*rng.uniform(0., .05), expo, stamp, 0.
        s.lp[token, 0] = 10**rng.uniform(18., 26.)*(rng.random() < .9)
        s.balances[token, -4] = s.lp[token, 0]*rng.uniform(0., 3.)*(rng.random() < .9)
    i = int(rng.integers(0, 4))
    p = s.positions[i]
    p[COLL], p[DEBT] = (0., 1.) if rng.random() < .8 else (1., 0.)
    lo, hi = s.cfg[int(p[COLL]), 12], s.cfg[int(p[COLL]), 13]
    remaining = rng.choice([rng.uniform(-1e5, lo), rng.uniform(hi, 2*hi+1.)]) if rng.random() < .3 else rng.uniform(lo, hi)
    p[START] = clock-rng.uniform(0., 3e6)
    p[TERM] = remaining+clock-p[START]
    p[C] = 0. if rng.random() < .3 else 10**rng.uniform(0., 28.)
    p[B] = 10**rng.uniform(0., 27.)
    p[PRINCIPAL], p[ACCRUED] = p[B]*rng.uniform(.5, 1.5), 10**rng.uniform(0., 24.)*(rng.random() < .7)
    p[ACTIVE], p[LAST] = rng.random() < .9, clock-rng.uniform(-1e4, 1e6)
    c, d, t = int(p[COLL]), int(p[DEBT]), rng.uniform(0., 1e7)
    rates[:] = rng.uniform(0., al.G, 2)*(1.-1.2*(rng.random(2) < .1))
    pc, pd = outcome(ref_price, s, c), outcome(ref_price, s, d)
    ratio = pc/pd if isinstance(pc, float) and isinstance(pd, float) and pd > 0 else 1.
    ratio = ratio if math.isfinite(ratio) and ratio > 0 else 1.
    tight[c, d] = 0. if rng.random() < .1 else ratio*math.exp(-rates[d]*t)*10**rng.uniform(-.3, .3)
    r.barriers[i] = ratio*math.exp(-1.075/YEAR*t)*10**rng.uniform(-.3, .3)
    r.book_locations[i], r.pending[i] = -1 if rng.random() < .1 else 0, rng.random() < .2
    return i, t


@pytest.mark.parametrize('m0', [True, False])
@pytest.mark.parametrize('model', sorted(REGISTRY))
def test_relink_chain_cores_match_the_namedtuple_kernels(model, m0):
    s, r, threshold_nb = fixture(model, m0)
    rng, tight, rates = np.random.default_rng(len(model)+7*m0), np.zeros((2, 2)), np.zeros(2)
    tally = dict(relinked=0, eligible=0, raised=0)
    for _ in range(400):
        i, t = scramble(s, r, rng, tight, rates)
        c, d = int(s.positions[i, COLL]), int(s.positions[i, DEBT])
        arrays = s.positions, s.prices, s.meta, s.cfg, s.lp, s.balances, s.params, s.switches
        for token in (c, d):
            assert same(outcome(vault.price_core, s.prices, s.meta, token), outcome(ref_price, s, token))
            assert same(outcome(vault.price, s, token), outcome(ref_price, s, token))
            assert outcome(pools.apy_core, s.cfg, s.lp, s.balances, token) == outcome(ref_apy, s, token)
        for opening in (False, True):
            assert (outcome(vault.risk_prices_core, s.prices, s.meta, s.switches, c, d, opening)
                    == outcome(ref_risk_prices, s, c, d, opening))
        total, pc, pd = (10**rng.uniform(-1., 27.)*(rng.random() < .95) for _ in range(3))
        assert outcome(vault.value_core, s.cfg, s.switches, d, total, pd) == outcome(ref_value, s, d, total, pd)
        want = outcome(ref_health, s, i, total, pc, pd, threshold_nb)
        assert same(outcome(liquidation.health_core, s.positions, s.prices, s.meta, s.cfg, s.params, s.switches,
                            i, total, pc, pd, threshold_nb), want)
        assert same(outcome(liquidation.health, s, i, total, pc, pd, threshold_nb), want)
        tally['raised'] += isinstance(want, tuple)
        want = outcome(ref_eligible, s, i, threshold_nb)
        assert outcome(na.eligible_core, *arrays, i, threshold_nb) == want
        assert outcome(na.eligible, s, i, threshold_nb) == want
        tally['eligible'] += want == True  # noqa: E712, a NumPy bool without the JIT
        want = outcome(ref_relinks, s, r, i, t, threshold_nb, tight, rates)
        assert outcome(al.relinks_core, *arrays, r.barriers, r.book_locations, r.pending, r.settings[1], i, t,
                       threshold_nb, tight, rates) == want
        assert outcome(al.relinks, s, r, i, t, threshold_nb, tight, rates) == want
        tally['relinked'] += want == True  # noqa: E712, a NumPy bool without the JIT
    # The random inputs must reach both outcomes of every kernel, or the comparison is vacuous.
    assert tally['relinked'] > 0 and tally['eligible'] > tally['relinked'] and 0 < tally['raised'] < 400, tally
