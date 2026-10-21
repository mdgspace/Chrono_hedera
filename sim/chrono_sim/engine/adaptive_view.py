"""Per-path lazy market and oracle view for the adaptive engine.

Holds the coarse path, the band oracle's per-asset revealed nodes and pending pushes, two
heartbeat-window oracle tapes and diagnostic counters. The default band oracle keeps only the
window start and push ticks on a tape (P3C_ORACLE_SAMPLER_DESIGN.md section 4); the exhaustive
1 s oracle (cfg[8] = 1, a test reference) refines every second through the nested sampler and
its level-1 cache. Tapes are built forward in time from keyed streams, so a rebuild from t = 0
recomputes identical values.
"""
from typing import NamedTuple
import math
import numpy as np
from numba import njit
from chrono_sim.market.nested import refine_segment, refine_piece
from chrono_sim.oracle.event import window_tape, keeper_up, band_window, stable_window, RING, STORE

SLOTS = 4
# Counters: segments refined, pieces refined, tapes built, reads, windows visited, band runs decided,
# band continuous exits, band forward steps, scans, doomed retries, fast-forwarded links.
N_COUNTERS = 11


class View(NamedTuple):
    t0: np.ndarray
    t1: np.ndarray
    x0: np.ndarray
    x1: np.ndarray
    zmin: np.ndarray
    iv_first: np.ndarray
    iv_zmin: np.ndarray
    jump_t: np.ndarray
    jump_a: np.ndarray
    role: np.ndarray
    sig: np.ndarray
    stable: np.ndarray
    cfg: np.ndarray  # H, coarse_dt, cadence, deviation, horizon, exhaustive scan, conf c0, conf c2, 1 s oracle
    key: np.ndarray
    changes: np.ndarray
    up: np.ndarray
    med_g: np.ndarray
    med_len: np.ndarray
    med_t: np.ndarray
    med_z: np.ndarray
    med_pm: np.ndarray
    med_tau: np.ndarray
    med_own: np.ndarray
    obs: np.ndarray
    conf: np.ndarray
    tape_k: np.ndarray
    tape_m: np.ndarray
    tape_t: np.ndarray
    tape_v: np.ndarray
    tape_s: np.ndarray
    tape_lo: np.ndarray
    tape_hi: np.ndarray
    counters: np.ndarray
    avail: np.ndarray
    iv: np.ndarray
    rec: np.ndarray
    store: np.ndarray
    store_n: np.ndarray
    pend: np.ndarray
    ring: np.ndarray
    ring_n: np.ndarray
    trace: np.ndarray
    trace_n: np.ndarray
    scan_t: np.ndarray
    rng: np.ndarray
    out: np.ndarray
    state: np.ndarray


def make_view(path, role, sig, stable, cfg, key, changes, up, trace=0):
    """trace > 0 records up to that many revealed band nodes per asset (tests only)."""
    n, H = path.x0.shape[0], int(cfg[0])
    nodes = int(cfg[1]//cfg[0])+2
    # Integer seconds, publication ticks, availability ticks and per-asset due ticks of one window.
    ticks = (2+n)*H+len(changes)+8
    changes = np.asarray(changes, np.float64)
    avail = np.ceil(changes/cfg[2])*cfg[2]
    return View(*path, np.asarray(role, np.float64), np.asarray(sig, np.float64), np.asarray(stable),
                np.asarray(cfg, np.float64), np.array([key], np.int64),
                changes, np.asarray(up, np.bool_),
                np.full(SLOTS, -1, np.int64), np.zeros(SLOTS, np.int64), np.zeros((SLOTS, nodes)),
                np.zeros((SLOTS, n, nodes)), np.zeros((SLOTS, n, nodes)), np.zeros((SLOTS, n)),
                np.zeros((SLOTS, n), np.int64), np.zeros((n, H)), np.zeros((n, H)),
                np.full(2, -1, np.int64), np.zeros(2, np.int64), np.zeros((2, ticks)),
                np.zeros((2, 3, n, ticks)), np.zeros((2, ticks), np.bool_), np.zeros((2, n)), np.zeros((2, n)),
                np.zeros(N_COUNTERS, np.int64), avail, np.zeros((64, 2), np.int64), np.zeros((64, 2)),
                np.zeros((n, STORE, 2)), np.zeros(n, np.int64), np.zeros((n, 4)),
                np.zeros(RING), np.zeros(1, np.int64), np.zeros((n, trace, 2)), np.zeros(n, np.int64),
                np.zeros(2*H+2), np.zeros((n, 1), np.uint64), np.zeros(1), np.zeros((3, n)))


@njit
def segment_at(v, t):
    return max(0, np.searchsorted(v.t0, t, side='right')-1)


@njit
def medium(v, g):
    """Cache slot holding the level-1 refinement of segment g for every asset."""
    for slot in range(SLOTS):
        if v.med_g[slot] == g:
            return slot
    slot = g % SLOTS
    key, H = v.key[0], v.cfg[0]
    for a in range(len(v.role)):
        z0, z1 = v.role[a]*v.x0[a, g], v.role[a]*v.x1[a, g]
        nodes, values, pm, tau, owner = refine_segment(key, a, g, v.t0[g], v.t1[g], z0, z1,
                                                       v.zmin[a, g], v.sig[a], H)
        m = len(nodes)
        v.med_t[slot, :m], v.med_z[slot, a, :m], v.med_pm[slot, a, :m-1] = nodes, values, pm
        v.med_tau[slot, a], v.med_own[slot, a], v.med_len[slot] = tau, owner, m
    v.med_g[slot] = g
    v.counters[0] += 1
    return slot


@njit
def window_segments(v, start, stop):
    return segment_at(v, start), max(0, np.searchsorted(v.t0, stop, side='left')-1)


@njit
def mark_conf(v, start, n_obs):
    c0, c2 = v.cfg[6], v.cfg[7]
    v.conf[:, :n_obs] = c0
    if c2 == 0:
        return
    for j in range(len(v.jump_t)):
        jt, a = v.jump_t[j], v.jump_a[j]
        lo, hi = max(int(math.ceil(jt)), int(start)), min(int(math.ceil(jt+60.)), int(start)+n_obs)
        for s in range(lo, hi):
            v.conf[a, s-int(start)] = c0+c2


@njit
def window_obs(v, k):
    """Fill v.obs with log prices at every integer second of window k; return their count."""
    H = v.cfg[0]
    start, stop = k*H, min((k+1)*H, v.cfg[4])
    n_obs = min(int(H), int(math.floor(v.cfg[4]))-int(start)+1)
    key = v.key[0]
    first, last = window_segments(v, start, stop)
    for g in range(first, last+1):
        slot = medium(v, g)
        for i in range(v.med_len[slot]-1):
            v0, v1 = v.med_t[slot, i], v.med_t[slot, i+1]
            if not start <= v0 < stop:
                continue
            for a in range(len(v.role)):
                if v.stable[a]:
                    continue
                low = v.med_pm[slot, a, i]
                tau = v.med_tau[slot, a] if v.med_own[slot, a] == i else -1.
                nodes, values = refine_piece(key, a, g, i, v0, v1, v.med_z[slot, a, i],
                                             v.med_z[slot, a, i+1], low, tau, v.sig[a])
                for q in range(len(nodes)-1):
                    s = nodes[q]
                    if s == math.floor(s) and start <= s < start+n_obs:
                        v.obs[a, int(s-start)] = v.role[a]*values[q]
            v.counters[1] += 1
    end = v.cfg[4]
    for a in range(len(v.role)):
        if v.stable[a]:
            v.obs[a, :n_obs] = v.x0[a, 0]
        elif end == math.floor(end) and start <= end < start+n_obs:
            v.obs[a, int(end-start)] = v.x1[a, -1]
    mark_conf(v, start, n_obs)
    return n_obs


@njit
def build_tape(v, k, slot, enter):
    H = v.cfg[0]
    n_obs = window_obs(v, k)
    # The horizon tick is inclusive; 1e-9 alone vanishes in float64 at year-scale horizons.
    end = v.cfg[4]+1e-9+1e-12*v.cfg[4]
    m = window_tape(k*H, min((k+1)*H, end), v.cfg[2], v.cfg[3], H, v.obs, v.conf, n_obs,
                    v.changes, v.up, enter, v.tape_t[slot], v.tape_v[slot], v.tape_s[slot])
    v.tape_k[slot], v.tape_m[slot] = k, m
    for a in range(len(v.role)):
        v.tape_lo[slot, a] = v.tape_v[slot, 0, a, :m].min()
        v.tape_hi[slot, a] = v.tape_v[slot, 0, a, :m].max()
    v.counters[2] += 1


@njit(inline='always')
def queue_due(ring, ring_n, u, H, cadence):
    """Remember the due tick a push at u queues (native_oracle.history), for heartbeat_tick's tick test."""
    ring[ring_n[0] % RING] = math.ceil((u+H)/cadence-1e-12)*cadence
    ring_n[0] += 1


@njit(inline='always')
def open_window(v, a, p, s, x):
    if v.stable[a]:
        stable_window(a, p, x, v.cfg, v.jump_t, v.jump_a, v.changes, v.up, v.avail, v.ring, v.ring_n[0], v.pend)
    else:
        band_window(a, p, s, x, v.cfg, v.key[0], v.sig, v.t0, v.t1, v.x0, v.x1, v.jump_t, v.jump_a,
                    v.changes, v.up, v.avail, v.ring, v.ring_n[0], v.iv, v.rec, v.store, v.store_n,
                    v.trace, v.trace_n, v.rng, v.out, v.counters, v.pend)


@njit
def start_band(v):
    """Reset the band state to t = 0 and open every asset's first window (native_oracle.history at now == 0)."""
    v.store_n[:], v.trace_n[:], v.ring_n[0] = 0, 0, 0
    queue_due(v.ring, v.ring_n, 0., v.cfg[0], v.cfg[2])
    for a in range(len(v.role)):
        open_window(v, a, 0., 0, v.x0[a, 0])


@njit(inline='always')
def build_band_tape(v, k, slot, enter):
    """Tape of window k from pending band pushes: the window start, then one entry per push tick."""
    H, horizon, cadence, pend = v.cfg[0], v.cfg[4], v.cfg[2], v.pend
    start, stop = k*H, min((k+1)*H, horizon+1e-9+1e-12*horizon)
    state, ticks, values = v.state, v.tape_t[slot], v.tape_v[slot]
    n = len(v.role)
    state[:, :] = enter
    ticks[0], m = start, 1
    values[:, :, 0] = state
    while True:
        u = np.inf
        for a in range(n):
            u = min(u, pend[a, 0])
        if u >= stop:
            break
        queue_due(v.ring, v.ring_n, u, H, cadence)
        for a in range(n):
            if pend[a, 0] == u:
                s, x = int(pend[a, 1]), pend[a, 2]
                state[0, a] = math.exp(x)
                state[1, a], state[2, a] = state[0, a]*pend[a, 3], u
                open_window(v, a, u, s, x)
        if u > start:
            m += 1
        ticks[m-1] = u
        values[:, :, m-1] = state
    v.tape_k[slot], v.tape_m[slot] = k, m
    for a in range(n):
        lo, hi = values[0, a, 0], values[0, a, 0]
        for i in range(1, m):
            lo, hi = min(lo, values[0, a, i]), max(hi, values[0, a, i])
        v.tape_lo[slot, a], v.tape_hi[slot, a] = lo, hi
    v.counters[2] += 1


@njit
def tape(v, k):
    """Cache slot holding the oracle tape of heartbeat window k.

    The push rule carries per-asset publish times across windows, so tapes are built in time
    order from the latest built window; the engine only ever reads forward in time.
    """
    for slot in range(2):
        if v.tape_k[slot] == k:
            return slot
    last = max(v.tape_k[0], v.tape_k[1])
    if k < last:
        raise RuntimeError('adaptive oracle tapes are built forward in time only')
    band = v.cfg[8] == 0
    if last < 0:
        enter = np.empty((3, len(v.role)))
        enter[0] = np.exp(v.x0[:, 0])
        enter[1] = enter[0]*v.cfg[6]
        enter[2] = 0.
        first = 0
        if band:
            start_band(v)
    else:
        held = 0 if v.tape_k[0] == last else 1
        enter = v.tape_v[held, :, :, v.tape_m[held]-1].copy()
        first = last+1
    for w in range(first, k+1):
        target = w % 2
        if band:
            build_band_tape(v, w, target, enter)
            enter = v.state
        else:
            build_tape(v, w, target, enter)
            enter = v.tape_v[target, :, :, v.tape_m[target]-1].copy()
    return k % 2


@njit
def read(v, t, out):
    """Stored (price, absolute confidence, publish time) per asset at time t."""
    H = v.cfg[0]
    k = int(math.floor(t/H))
    if k*H > v.cfg[4]:
        k -= 1
    slot = tape(v, k)
    m = v.tape_m[slot]
    idx = max(0, np.searchsorted(v.tape_t[slot, :m], t+1e-12, side='right')-1)
    out[:, :] = v.tape_v[slot, :, :, idx]
    v.counters[3] += 1
