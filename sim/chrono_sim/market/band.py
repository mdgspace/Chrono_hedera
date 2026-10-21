"""Exact two-sided band sampler for Brownian-bridge oracle paths (P3C_ORACLE_SAMPLER_DESIGN.md section 4).

A run is a drift-free Brownian bridge from (ta, xa) to (tb, xb) with variance s2 per second, monitored at
integer seconds for leaving the open log band (lo, hi). `first_exit` decides the run by the trichotomy of
section 4.2: no continuous exit (image series of Anderson 1960), or the exact first exit side and time
(inverse-Gaussian proposal thinned by the Bessel(3) first-passage-bridge probability, sections 4.3 and 4.4),
after which the path is a fresh bridge from the hit level (strong Markov) and is walked forward from the
first integer second after the exit. Draws come from one keyed stream per heartbeat window.
"""
import math
import numpy as np
from numba import njit
from .intrabar import _wald
from .keyed import uniform, normal

LEVEL_BAND = 3
TAIL_EXPONENT = 75.  # omitted series terms are below exp(-75) = 2.7e-33 (design section 5)


@njit(inline='always')
def hit_prob(d, e, v):
    """P(bridge hits a level at distance d > 0 from its start, with the end at signed distance e on the start side)."""
    return 1. if e <= 0 else math.exp(-2.*d*e/v)


@njit(inline='always')
def n_terms(w, v):
    return max(1, int(math.ceil(math.sqrt(TAIL_EXPONENT*v/(2.*w*w)))))


@njit
def exit_prob(a, b, w, v):
    """P(bridge from a to b in (0, w), variance v, leaves (0, w)): direct image sum, so small values keep precision."""
    k_max, pe = n_terms(w, v), 0.
    for k in range(-k_max, k_max+1):
        pe += math.exp(-2.*(a+k*w)*(b+k*w)/v)
        if k != 0:
            pe -= math.exp(-2.*k*w*(k*w+b-a)/v)
    return min(1., max(0., pe))


@njit
def exit_accept(d, w, vt):
    """P(a first-passage bridge from distance d to its level over variance vt avoids the far level at distance w).

    alpha = sum_k (1 + 2kw/d) exp(-2kw(d + kw)/vt), with the k and -k terms paired so that small d keeps precision.
    """
    if vt <= 0.:
        return 1.
    alpha = 1.
    for k in range(1, n_terms(w, vt)+1):
        kw = k*w
        x = 2.*kw*d/vt
        far, near = math.exp(-2.*kw*(kw+d)/vt), math.exp(-2.*kw*(kw-d)/vt)
        ratio = 1. if x < 1e-300 else -math.expm1(-2.*x)/(2.*x)
        alpha += far+near-8.*kw*kw/vt*near*ratio
    return min(1., max(0., alpha))


@njit
def hit_time(ta, tb, d, e, v, st):
    """Exact hit time of one level given that it is hit: r = t/(T - t) is IG(d/|e|, d^2/v) (section 4.4)."""
    if e == 0.:
        return tb
    r = _wald(d/abs(e), d*d/v, normal(st), uniform(st))
    return ta+(tb-ta)*r/(1.+r)


@njit
def exit_time(ta, xa, tb, xb, lo, hi, s2, p_hi, p_lo, st):
    """(upper, tau) with the exact two-sided first-exit law given an exit; acceptance rate >= 1/2."""
    w, v = hi-lo, s2*(tb-ta)
    while True:
        upper = uniform(st)*(p_hi+p_lo) < p_hi
        d, e = (hi-xa, hi-xb) if upper else (xa-lo, xb-lo)
        tau = hit_time(ta, tb, d, e, v, st)
        if uniform(st) < exit_accept(d, w, s2*(tau-ta)):
            return upper, tau


@njit(inline='always')
def bridge_value(t0, x0, t1, x1, t, s2, st):
    """Exact value at t of a Brownian bridge (t0, x0) -> (t1, x1) with variance s2 per second."""
    f = (t-t0)/(t1-t0)
    mean = x0+(x1-x0)*f
    return mean if s2 == 0. else mean+math.sqrt(s2*(t-t0)*(t1-t)/(t1-t0))*normal(st)


@njit(inline='always')
def monitored(s, iv, n_iv):
    for i in range(n_iv):
        if iv[i, 0] <= s <= iv[i, 1]:
            return True
    return False


@njit(inline='always')
def any_monitored(first, last, iv, n_iv):
    for i in range(n_iv):
        if iv[i, 0] <= last and first <= iv[i, 1]:
            return True
    return False


@njit(inline='always')
def outside(x, stored, dev):
    """The reference deviation trigger, evaluated with the exact float expression of native_oracle.publish."""
    return abs(math.exp(x)/stored-1.) >= dev


@njit(inline='always')
def record(trace, tn, a, t, x):
    """Append (t, x) to asset a's node trace (trace[a, :tn[a]]); capacity 0 disables tracing."""
    if trace.shape[1]:
        if tn[a] >= trace.shape[1]:
            raise RuntimeError('band trace capacity exceeded')
        trace[a, tn[a], 0], trace[a, tn[a], 1] = t, x
        tn[a] += 1


@njit
def first_exit(ta, xa, tb, xb, y, stored, dev, s2, iv, n_iv, st, out, trace, tn, a, counts, c):
    """First monitored integer second in (ta, tb) whose value leaves the band around stored = exp(y), else -1.

    iv[:n_iv] are inclusive ranges of monitored seconds. The end node tb is the caller's to test. The exit
    value goes to out[0]; every revealed node is recorded in asset a's trace; counts[c:c+3] hold runs
    decided, continuous exits sampled and forward steps.
    """
    lo, hi = y+math.log1p(-dev), y+math.log1p(dev)
    while True:
        first, last = int(math.floor(ta))+1, int(math.ceil(tb))-1
        if first > last or not any_monitored(first, last, iv, n_iv):
            return -1
        t0, x0 = ta, xa
        if lo < xa < hi and s2 > 0.:
            counts[c] += 1
            p_hi, p_lo = hit_prob(hi-xa, hi-xb, s2*(tb-ta)), hit_prob(xa-lo, xb-lo, s2*(tb-ta))
            if lo < xb < hi:
                u = uniform(st)
                if u >= p_hi+p_lo or u >= exit_prob(xa-lo, xb-lo, hi-lo, s2*(tb-ta)):
                    return -1
            counts[c+1] += 1
            upper, t0 = exit_time(ta, xa, tb, xb, lo, hi, s2, p_hi, p_lo, st)
            x0 = hi if upper else lo
            record(trace, tn, a, t0, x0)
        else:
            counts[c+2] += 1
        s = math.floor(t0)+1.
        if s >= tb:
            return -1
        x = bridge_value(t0, x0, tb, xb, s, s2, st)
        record(trace, tn, a, s, x)
        if monitored(int(s), iv, n_iv) and outside(x, stored, dev):
            out[0] = x
            return int(s)
        ta, xa = s, x
