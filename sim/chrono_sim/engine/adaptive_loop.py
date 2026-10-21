"""Adaptive native event loop: coarse-to-fine scan scheduling and event-based oracle reads.

Protocol transitions, the action tape and the indexed liquidation heaps are the P3b native
ones; only price materialisation, oracle evaluation and scan scheduling differ
(P3C_METHOD.md section 5).
"""
import math
import numpy as np
from numba import njit, prange
from chrono_sim.protocol.fast.state import *
from chrono_sim.protocol.fast.vault import price, price_core
from .native_loop import Runtime, open_holder, action, enqueue
from .native_actions import eligible, eligible_core, barrier_at
from chrono_sim.protocol.fast.math import WAD, YEAR
from chrono_sim.protocol.fast.pools import apy, accrue, can_absorb
from chrono_sim.protocol.fast.math import checked, wm
from chrono_sim.protocol.fast.vault import debt_ledger

G = 1.075/YEAR  # the borrow-rate bound baked into P3b barrier keys (native_actions.refresh)
from .native_heap import push, pop
from .adaptive_view import read, tape
from chrono_sim.oracle.event import pub


@njit
def runtime(s, holders, draws, settings):
    capacity, n, m = len(s.positions), len(holders), len(s.cfg)
    return Runtime(np.empty((n+4*capacity+8, 6)), np.array([0, n, 0, 0, 0], np.int64),
                   holders.copy(), draws, np.zeros(n, np.int64), np.zeros(capacity, np.bool_),
                   np.zeros(capacity, np.int64), np.zeros(capacity), np.zeros((m, m)), settings,
                   np.empty((m*m, capacity), np.int64), np.zeros(m*m, np.int64),
                   np.full(capacity, -1, np.int64), np.zeros((m, m), np.bool_))


@njit
def set_prices(s, v, now, buf, base):
    read(v, now, buf)
    for t in range(len(s.prices)):
        s.prices[t, 0], s.prices[t, 1], s.prices[t, 2] = buf[0, t]*1e8, buf[1, t]*1e8, -8.
        s.prices[t, 3], s.prices[t, 4] = base+buf[2, t], 0.


@njit
def bound(top, rate, t):
    """Grown barrier at relative time t for a key re-based by tight_tops; the debt APY is constant
    until the next state change, and every state change recomputes the schedule."""
    return top*math.exp(rate*t)*(1.+1e-12)


@njit
def pair_tops(s, r, out, rates, free):
    """Per pair, the max over live keys (only positions not pending if free) re-based from the 107.5% bound
    to the current debt APY: key exp((G - rate)(LAST - base)) exp(rate t) = debt bound exp(rate (t - LAST))."""
    m, base = len(r.tops), r.settings[1]
    out.fill(0.)
    for c in range(m):
        for d in range(m):
            p = c*m+d
            for a in range(r.book_counts[p]):
                i = r.book_heaps[p, a]
                if not (free and r.pending[i]):
                    out[c, d] = max(out[c, d], r.barriers[i]*math.exp((G-rates[d])*(s.positions[i, LAST]-base)))


@njit
def tight_tops(s, r, out, rates):
    """Current debt APYs and the re-based tops of every live key (P3C_METHOD.md section 5)."""
    for d in range(len(r.tops)):
        rates[d] = apy(s, d)/WAD/YEAR
        if rates[d] > G:
            raise RuntimeError('debt APY above the 107.5% bound of the barrier keys')
    pair_tops(s, r, out, rates, False)


@njit
def tick_hit(v, tops, rates, slot, idx, u):
    for c in range(len(tops)):
        for d in range(len(tops)):
            if tops[c, d] > 0:
                ratio = v.tape_v[slot, 0, c, idx]/v.tape_v[slot, 0, d, idx]
                if ratio <= bound(tops[c, d], rates[d], u)*(1.+1e-9):
                    return True
    return False


@njit
def window_clear(v, tops, rates, slot, end):
    """True if no stored ratio in the window can reach its pair's grown barrier: stored prices
    only take the tape's values, so min collateral over max debt bounds every tick's ratio."""
    for c in range(len(tops)):
        for d in range(len(tops)):
            if tops[c, d] > 0 and v.tape_lo[slot, c]/v.tape_hi[slot, d] <= bound(tops[c, d], rates[d], end)*(1.+1e-9):
                return False
    return True


@njit
def scan_clock(v, k):
    """The P3b scan clock of window k (integer seconds and publication ticks) into v.scan_t; returns its length."""
    H, c, horizon = v.cfg[0], v.cfg[2], v.cfg[4]
    start = k*H
    stop = min(start+H, horizon+1e-9+1e-12*horizon)
    m = 0
    for j in range(min(int(H), int(math.floor(horizon))-int(start)+1)):
        s = start+j
        u = pub(s, c)
        if s < stop:
            v.scan_t[m], m = s, m+1
        if u != s and u < stop:
            v.scan_t[m], m = u, m+1
    return m


@njit
def first_hit(v, tops, rates, slot, idx, lo, hi):
    """First scan-clock index in [lo, hi) whose stored ratio reaches a grown barrier, else -1.

    The stored state is constant on the stretch and bound() grows with u when every rate is >= 0, so
    the hit predicate is monotone there and a binary search returns the exhaustive walk's first hit."""
    if lo >= hi:
        return -1
    if np.any(rates < 0):
        for j in range(lo, hi):
            if tick_hit(v, tops, rates, slot, idx, v.scan_t[j]):
                return j
        return -1
    if not tick_hit(v, tops, rates, slot, idx, v.scan_t[hi-1]):
        return -1
    while lo < hi-1:
        mid = (lo+hi-1)//2
        if tick_hit(v, tops, rates, slot, idx, v.scan_t[mid]):
            hi = mid+1
        else:
            lo = mid+1
    return lo


@njit
def next_scan(v, tops, rates, lo, hi):
    """First P3b scan tick u with lo < u <= hi at which some live pair may be eligible, else inf.

    Tapes hold the stored state at the window start and at every push tick; between entries the state
    is constant, so each stretch of the scan clock is searched by first_hit (P3C_ORACLE_SAMPLER_DESIGN.md 4.6).
    """
    if not np.any(tops > 0):
        return np.inf
    H, horizon = v.cfg[0], v.cfg[4]
    exhaustive = v.cfg[5] > 0  # test oracle: scan at every tick of the P3b clock
    k = max(0, int(math.floor(lo/H)))
    while k*H <= min(hi, horizon):
        v.counters[4] += 1
        slot = tape(v, k)
        if not exhaustive and window_clear(v, tops, rates, slot, min((k+1)*H, horizon)):
            k += 1
            continue
        m = scan_clock(v, k)
        first = np.searchsorted(v.scan_t[:m], lo, side='right')
        final = np.searchsorted(v.scan_t[:m], hi, side='right')
        if exhaustive:
            if first < final:
                return v.scan_t[first]
            if final < m:
                return np.inf
            k += 1
            continue
        entries = v.tape_m[slot]
        for idx in range(entries):
            edge = m if idx+1 == entries else np.searchsorted(v.scan_t[:m], v.tape_t[slot, idx+1]-1e-12)
            j = first_hit(v, tops, rates, slot, idx, max(first, np.searchsorted(v.scan_t[:m], v.tape_t[slot, idx]-1e-12)),
                          min(edge, final))
            if j >= 0:
                return v.scan_t[j]
        if final < m:
            return np.inf
        k += 1
    return np.inf


@njit
def stretch_hits(v, tops, rates, slot, m, first, final):
    """Scan-clock indices in [first, final) of window slot whose stored ratio reaches a grown barrier."""
    n, entries = 0, v.tape_m[slot]
    for idx in range(entries):
        edge = m if idx+1 == entries else np.searchsorted(v.scan_t[:m], v.tape_t[slot, idx+1]-1e-12)
        lo = max(first, np.searchsorted(v.scan_t[:m], v.tape_t[slot, idx]-1e-12))
        hi = min(edge, final)
        if np.any(rates < 0):
            for j in range(lo, hi):
                n += tick_hit(v, tops, rates, slot, idx, v.scan_t[j])
        else:
            # Monotone predicate on a stretch: every tick from the first hit on hits too.
            j = first_hit(v, tops, rates, slot, idx, lo, hi)
            n += hi-j if j >= 0 else 0
    return n


@njit
def count_scans(v, tops, rates, lo, hi):
    """Number of scan ticks u with lo < u <= hi that the walk u = next_scan(v, tops, rates, u, hi) visits."""
    if not np.any(tops > 0) or not lo < hi:
        return 0
    H, horizon, n = v.cfg[0], v.cfg[4], 0
    exhaustive = v.cfg[5] > 0
    k = max(0, int(math.floor(lo/H)))
    while k*H <= min(hi, horizon):
        slot = tape(v, k)
        if not exhaustive and window_clear(v, tops, rates, slot, min((k+1)*H, horizon)):
            k += 1
            continue
        m = scan_clock(v, k)
        first = np.searchsorted(v.scan_t[:m], lo, side='right')
        final = np.searchsorted(v.scan_t[:m], hi, side='right')
        n += final-first if exhaustive else stretch_hits(v, tops, rates, slot, m, first, final)
        if final < m:
            return n
        k += 1
    return n


@njit
def crossed(s, r, p, rate, ratio, now, ids, count, stack):
    """Append heap members of pair p whose own APY-grown barrier is at or above ratio. Subtrees are
    pruned on the 107.5% keys, which order the heap and bound the APY-grown barrier from above."""
    heap, n, depth, base = r.book_heaps[p], r.book_counts[p], 0, r.settings[1]
    if n:
        stack[0], depth = 0, 1
    while depth:
        depth -= 1
        a = stack[depth]
        i = heap[a]
        if ratio <= barrier_at(r.barriers[i], now):
            if ratio <= bound(r.barriers[i]*math.exp((G-rate)*(s.positions[i, LAST]-base)), rate, now):
                ids[count] = i
                count += 1
            for child in (2*a+1, 2*a+2):
                if child < n:
                    stack[depth] = child
                    depth += 1
    return count


@njit
def scan_live(s, r, now, threshold_nb, ids, stack, tight, rates):
    """P3b scan semantics in ascending position order, visiting only positions whose own conservative
    barrier is crossed: a position above its own bound cannot be eligible (P3C_METHOD.md section 5)."""
    m, count = len(r.tops), 0
    for c in range(m):
        for d in range(m):
            if tight[c, d] <= 0:
                continue
            try:
                ratio = price(s, c)/price(s, d)
            except Exception:
                continue
            if ratio <= bound(tight[c, d], rates[d], now):
                count = crossed(s, r, c*m+d, rates[d], ratio, now, ids, count, stack)
    if not count:
        return
    for i in np.sort(ids[:count]):
        if s.positions[i, ACTIVE] and not r.pending[i] and eligible(s, i, threshold_nb):
            r.pending[i] = True
            enqueue(r, now+r.settings[2], 2, 3, -1, i)


@njit
def doom_code(s, r, i, now):
    """0 if a soft liquidation of i may succeed; 1 if it must revert with every kernel step passing; 2 if a
    kernel step raises, which reverts too. With no collateral left the seizure is zero, so absorb() rejects
    it whenever the SP can absorb the close amount. Evaluated on action()'s clock with the kernel's own
    accrual; restores the accrual fields it touches and leaves s.meta[0] at that clock (P3C_ENGINE_REPORT.md)."""
    p = s.positions[i]
    if not p[ACTIVE] or p[C] != 0:
        return 0
    s.meta[0] = r.settings[1]+int(now)
    accrued, last, code = p[ACCRUED], p[LAST], 2
    try:
        principal, delta = debt_ledger(s, i, accrue(s, i))
        cf = p[CLOSE] if s.switches[3] else s.cfg[int(p[DEBT]), 4]
        amount = min(1e26, wm(checked(principal+delta), cf))
        code = 1 if amount == 0 or can_absorb(s, int(p[DEBT]), amount) else 0
    except Exception:
        pass
    p[ACCRUED], p[LAST] = accrued, last
    return code


@njit
def doomed(s, r, i, now):
    """True if action() must revert a soft liquidation of i (doom_code)."""
    return doom_code(s, r, i, now) > 0


@njit
def retry(s, r, i, now, threshold_nb, ids, stack, tight, rates):
    """action() on a doomed soft liquidation without the call: execute() would zero the flows and
    restore everything else, leaving the revert count, the release of i and P3b's rescan. The state and
    the keys are unchanged, so the rescan is the pruned scan_live of a scan tick."""
    s.flows.fill(0.)
    r.control[3] += 1
    r.pending[i] = False
    if r.settings[2] > 0:
        scan_live(s, r, now, threshold_nb, ids, stack, tight, rates)


@njit
def doomed_until(s, r, i, lo, hi):
    """Largest second x in [lo, hi] with doom_code 1, else lo-1. Code 1 at x proves a revert at every second
    up to x: accrual, and so the close amount, is nondecreasing in the clock, can_absorb only accepts more
    for less, and a raising kernel step reverts too (P3C_ENGINE_REPORT.md)."""
    if doom_code(s, r, i, float(hi)) == 1:
        return hi
    if doom_code(s, r, i, float(lo)) != 1:
        return lo-1
    while lo < hi-1:
        mid = (lo+hi)//2
        if doom_code(s, r, i, float(mid)) == 1:
            lo = mid
        else:
            hi = mid
    return lo


@njit
def relinks_core(positions, prices, meta, cfg, lp, balances, params, switches, barriers, book_locations, pending, base,
                 i, t, threshold_nb, tight, rates):
    """scan_live(t) restricted to i: True if it enqueues i. Its ancestors in the pair's max-heap have keys
    at or above its own, so crossed() reaches i whenever i's own barrier test passes. Takes the arrays it
    reads, not the State and Runtime, so a link pays no per-member refcounts (P3C_ENGINE_REPORT.md)."""
    p = positions[i]
    c, d = int(p[COLL]), int(p[DEBT])
    if tight[c, d] <= 0 or book_locations[i] < 0:
        return False
    try:
        ratio = price_core(prices, meta, c)/price_core(prices, meta, d)
    except Exception:
        return False
    if not ratio <= bound(tight[c, d], rates[d], t) or not ratio <= barrier_at(barriers[i], t):
        return False
    if not ratio <= bound(barriers[i]*math.exp((G-rates[d])*(p[LAST]-base)), rates[d], t):
        return False
    if not p[ACTIVE] or pending[i]:
        return False
    return eligible_core(positions, prices, meta, cfg, lp, balances, params, switches, i, threshold_nb)


@njit(inline='always')
def relinks(s, r, i, t, threshold_nb, tight, rates):
    return relinks_core(s.positions, s.prices, s.meta, s.cfg, s.lp, s.balances, s.params, s.switches, r.barriers,
                        r.book_locations, r.pending, r.settings[1], i, t, threshold_nb, tight, rates)


@njit
def window_of(v, t):
    """Tape window of time t, as read() picks it."""
    k = int(math.floor(t/v.cfg[0]))
    return k-1 if k*v.cfg[0] > v.cfg[4] else k


@njit
def stretch_of(v, slot, t):
    """Tape entry of time t in window slot, as read() picks it; the stored state is constant on it."""
    return max(0, np.searchsorted(v.tape_t[slot, :v.tape_m[slot]], t+1e-12, side='right')-1)


@njit
def stretch_end(v, slot, k, idx):
    return v.tape_t[slot, idx+1] if idx+1 < v.tape_m[slot] else (k+1)*v.cfg[0]


@njit
def next_entry(v, slot, idx):
    """Time of the tape entry after idx in window slot; inf on the window's last entry."""
    return v.tape_t[slot, idx+1] if idx+1 < v.tape_m[slot] else np.inf


# Test hooks, no-ops the JIT inlines away (their unused arguments are dead, so they bind no NamedTuple).
@njit(inline='always')
def stretch_cached(v, tops_x, rates, k, idx, slot, t):
    """A link at t reuses the cached stretch (k, idx) of slot."""
    pass


@njit(inline='always')
def before_link(s, r, v, i, t, threshold_nb, tight, rates):
    """fast_forward is about to run the link of i at t."""
    pass


@njit
def walk(v, tops_x, rates, k, idx, kt, it):
    """Advance from stretch (k, idx) to (kt, it); False if a scan tick of a stretch left behind may reach a
    free key. The stored ratio is constant on a stretch and bound() grows in time, so the test at the
    stretch's end covers each of its ticks."""
    while k < kt or idx < it:
        slot = tape(v, k)
        if tick_hit(v, tops_x, rates, slot, idx, stretch_end(v, slot, k, idx)):
            return False
        idx += 1
        if idx == v.tape_m[slot]:
            k, idx = k+1, 0
    return True


@njit
def flush(r, v, tight, rates, lo, hi):
    """Count the scan ticks in (lo, hi] that run_path would have visited: each finds every free key below its
    ratio (walk, tick_hit) and every chain member pending, so it only counts as an event and a scan."""
    n = count_scans(v, tight, rates, lo, min(hi, v.cfg[4]))
    r.control[2] += n
    v.counters[8] += n
    return hi


@njit
def fast_forward(s, r, v, now, threshold_nb, tight, rates, tops_x, proved, buf):
    """Run the doomed retry chains at the top of the heap without the loop: links pop and push the heap
    exactly as retry() does, skipped scan ticks are counted, and it stops before any event, scan tick or
    link it cannot prove a no-op revert. Returns the time of the last link run (P3C_ENGINE_REPORT.md)."""
    if r.settings[2] <= 0 or np.any(rates < 0):
        return now
    pair_tops(s, r, tops_x, rates, True)
    proved.fill(-1)
    k = window_of(v, now)
    slot = tape(v, k)
    idx = stretch_of(v, slot, now)
    edge = next_entry(v, slot, idx)
    pk, pidx, t_last, counted = k, idx, now, now
    while r.control[0]:
        t, i = r.heap[0, 0], int(r.heap[0, 5])
        if r.heap[0, 3] != 3 or not s.positions[i, ACTIVE] or s.positions[i, C] != 0:
            break
        kt = window_of(v, t)
        if kt == k and t+1e-12 < edge:
            # Link times are nondecreasing and nothing on this path evicts a tape: tape() returns slot,
            # stretch_of() (searchsorted on t + 1e-12) returns idx and walk() takes no step.
            it = idx
            stretch_cached(v, tops_x, rates, k, idx, slot, t)
        else:
            if kt > k+1:
                break  # ponytail: at most one window per link keeps both tapes next_scan(t_last) reads cached
            if kt > k:
                counted = flush(r, v, tight, rates, counted, t_last)
            slot = tape(v, kt)
            it = stretch_of(v, slot, t)
            if not walk(v, tops_x, rates, k, idx, kt, it):
                break
            edge = next_entry(v, slot, it)
        if tick_hit(v, tops_x, rates, slot, it, t):
            break
        k, idx = kt, it
        if int(t) > proved[i]:
            proved[i] = doomed_until(s, r, i, int(t), int(stretch_end(v, slot, k, idx)))
            if int(t) > proved[i]:
                break
        if k != pk or idx != pidx:
            set_prices(s, v, t, buf, r.settings[1])
            pk, pidx = k, idx
        t_last = t
        before_link(s, r, v, i, t, threshold_nb, tight, rates)
        # The link as run_path, doomed() and retry() leave it: the event and the revert counted, i released and
        # rescanned. Written out, not called: a call or an inlined function taking the State, Runtime or View
        # binds every member array with a refcount (P3C_ENGINE_REPORT.md).
        r.control[0] = pop(r.heap, r.control[0])[1]
        s.meta[0] = r.settings[1]+int(t)
        s.flows.fill(0.)
        r.control[2] += 1
        r.control[3] += 1
        v.counters[9] += 1
        v.counters[10] += 1
        r.pending[i] = False
        if not relinks_core(s.positions, s.prices, s.meta, s.cfg, s.lp, s.balances, s.params, s.switches, r.barriers,
                            r.book_locations, r.pending, r.settings[1], i, t, threshold_nb, tight, rates):
            break
        r.pending[i] = True
        enqueue(r, t+r.settings[2], 2, 3, -1, i)
    flush(r, v, tight, rates, counted, t_last)
    s.meta[0] = r.settings[1]+int(t_last)
    return t_last


@njit
def run_path(s, holders, draws, params, terms, settings, v, open_nb, threshold_nb, logs):
    r = runtime(s, holders, draws, settings)
    for h in range(len(holders)):
        r.control[0] = push(r.heap, r.control[0], settings[0], holders[h, 7], 1, h, 1, h, -1)
    buf, ids = np.empty((3, len(s.prices))), np.empty(len(s.positions), np.int64)
    stack = np.empty(len(s.positions)+2, np.int64)
    tight, rates, tops_x = np.zeros_like(r.tops), np.zeros(len(r.tops)), np.zeros_like(r.tops)
    proved = np.empty(len(s.positions), np.int64)
    horizon, scan_t = settings[0], np.inf
    while r.control[0] or scan_t < np.inf:
        agent_t = r.heap[0, 0] if r.control[0] else np.inf
        if scan_t <= agent_t:
            now = scan_t
            s.meta[0] = settings[1]+now
            set_prices(s, v, now, buf, settings[1])
            v.counters[8] += 1
            scan_live(s, r, now, threshold_nb, ids, stack, tight, rates)
        else:
            event, count = pop(r.heap, r.control[0])
            r.control[0] = count
            now, kind, h, i = event[0], int(event[3]), int(event[4]), int(event[5])
            s.meta[0] = settings[1]+now
            # Calls on closed positions are price-independent no-ops; skip their oracle read.
            if not (2 <= kind <= 5 and not s.positions[i, ACTIVE]):
                set_prices(s, v, now, buf, settings[1])
            reverts = r.control[3]
            if kind == 1 or kind == 6:
                open_holder(s, r, h, now, params, terms, open_nb, threshold_nb, logs)
            elif kind == 3 and doomed(s, r, i, now):
                retry(s, r, i, now, threshold_nb, ids, stack, tight, rates)
                v.counters[9] += 1
                now = fast_forward(s, r, v, now, threshold_nb, tight, rates, tops_x, proved, buf)
            else:
                action(s, r, kind, h, i, now, params, terms, open_nb, threshold_nb, logs)
            # A reverted call restores the state, so keys and APYs are unchanged.
            if r.control[3] == reverts:
                tight_tops(s, r, tight, rates)
        r.control[2] += 1
        following = r.heap[0, 0] if r.control[0] else np.inf
        scan_t = next_scan(v, tight, rates, now, min(following, horizon))
    # Final marks use the stored state at the horizon, as the P3b clock's last tick does.
    s.meta[0] = settings[1]+horizon
    set_prices(s, v, horizon, buf, settings[1])
    return r.control[2:5]


@njit(parallel=True)
def run_batch(jobs, tapes, stats, open_nb, threshold_nb):
    for index in prange(len(jobs)):
        path = np.int64(index)
        s, h, draws, params, terms, settings, view = jobs[path]
        stats[path] = run_path(s, h, draws, params, terms, settings, view, open_nb, threshold_nb, tapes[path])
