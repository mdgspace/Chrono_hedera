"""Per-path native event queue, with an action tape for I5 record collection."""
from typing import NamedTuple
import numpy as np
from numba import njit, types, prange
from numba.typed import List
from chrono_sim.protocol.fast.state import *
from chrono_sim.protocol.fast.vault import price
from .native_actions import execute, refresh, eligible, barrier_at
from .native_heap import push, pop
from .native_windows import next_oracle
from .native_book_heap import update

F1, F2, F3 = (types.Array(types.float64, n, 'C') for n in (1, 2, 3))
TAPE_TYPE = types.Tuple((types.int64, types.int64, types.int64, F1, F1, F2, F2, F2, F2, F3, F2, types.float64))


class Runtime(NamedTuple):
    heap: np.ndarray
    control: np.ndarray
    holders: np.ndarray
    draws: np.ndarray
    draw_index: np.ndarray
    pending: np.ndarray
    owner: np.ndarray
    barriers: np.ndarray
    tops: np.ndarray
    settings: np.ndarray
    book_heaps: np.ndarray
    book_counts: np.ndarray
    book_locations: np.ndarray
    eligible_pairs: np.ndarray


@njit
def enqueue(r, at, priority, kind, holder, position):
    c = r.control
    c[0] = push(r.heap, c[0], r.settings[0], at, priority, c[1], kind, holder, position)
    c[1] += 1


@njit
def update_top(s, r, i):
    h = r.owner[i]
    c, d = int(s.positions[i, COLL]), int(s.positions[i, DEBT])
    previous = r.barriers[i]
    refresh(s, i, r.barriers, r.settings[1], r.settings[5], r.holders[h, 9])
    value, r.barriers[i] = r.barriers[i], previous
    pair = c*len(s.cfg)+d
    heap = r.book_heaps[pair]
    count = update(heap, r.book_locations, r.barriers, r.book_counts[pair], i, value)
    r.book_counts[pair] = count
    r.tops[c, d] = r.barriers[heap[0]] if count else 0.


@njit
def scan(s, r, now, threshold_nb):
    pairs = r.eligible_pairs
    pairs.fill(False)
    any_pair = False
    for c in range(len(r.tops)):
        for d in range(len(r.tops)):
            if r.tops[c, d] <= 0:
                continue
            try:
                pairs[c, d] = price(s, c)/price(s, d) <= barrier_at(r.tops[c, d], now)
            except Exception:
                continue
            any_pair = any_pair or pairs[c, d]
    if not any_pair:
        return
    for i in range(int(s.meta[1])-1):
        p = s.positions[i]
        if p[ACTIVE] and not r.pending[i] and pairs[int(p[COLL]), int(p[DEBT])]:
            if eligible(s, i, threshold_nb):
                r.pending[i] = True
                enqueue(r, now+r.settings[2], 2, 3, -1, i)


@njit
def log_action(logs, kind, i, h, old, old_row, s):
    logs.append((kind, i, h, old_row, s.positions[i].copy(),
                 old.balances, s.balances.copy(), old.lp, s.lp.copy(),
                 s.flows.copy(), s.prices.copy(), s.meta[0]))


@njit
def open_holder(s, r, h, now, params, terms, open_nb, threshold_nb, logs):
    draw = r.draws[h, r.draw_index[h]]
    r.draw_index[h] += 1
    i = int(s.meta[1])-1
    s.meta[0] = r.settings[1]+int(now)
    error, old, row = execute(s, 1, i, r.holders[h], params[h], terms[h], open_nb, threshold_nb, int(r.settings[4]))
    if error:
        r.control[3] += 1
        return
    r.owner[i] = h
    log_action(logs, 1, i, h, old, row, s)
    update_top(s, r, i)
    term, lead = r.holders[h, 3], r.holders[h, 5]
    enqueue(r, s.positions[i, SCHEDULE]-r.settings[1]+r.settings[3], 3, 4, h, i)
    enqueue(r, now+term+900+r.settings[2], 2, 5, h, i)
    if draw >= r.holders[h, 6]:
        enqueue(r, now+term-lead, 2, 2, h, i)


@njit
def action(s, r, kind, h, i, now, params, terms, open_nb, threshold_nb, logs):
    c = int(s.positions[i, COLL])
    returned = s.positions[i, C]/10.**s.cfg[c, 14]
    s.meta[0] = r.settings[1]+int(now)
    error, old, row = execute(s, kind, i, r.holders[0], params[0], terms[0], open_nb, threshold_nb, int(r.settings[4]))
    if error:
        r.control[3] += 1
    else:
        log_action(logs, kind, i, h, old, row, s)
        update_top(s, r, i)
    if kind == 5 and error and s.positions[i, ACTIVE]:
        enqueue(r, now+max(1., r.settings[2]), 3, kind, h, i)
    r.pending[i] = False
    if kind == 2 and r.holders[h, 8] and not s.positions[i, ACTIVE]:
        if returned > 0:
            r.holders[h, 2] = returned
            enqueue(r, now, 1, 6, h, i)
        else:
            # Exhausted roller: stop rolling and let I5 record the reason.
            log_action(logs, 7, i, h, s, s.positions[i].copy(), s)
    if kind == 3 and s.positions[i, ACTIVE] and r.settings[2] > 0:
        scan(s, r, now, threshold_nb)


@njit
def run_path(s, holders, draws, params, terms, settings, clock, history, windows, open_nb, threshold_nb, logs):
    capacity, n = len(s.positions), len(holders)
    r = Runtime(np.empty((n+4*capacity+8, 6)), np.array([0, n+len(clock), 0, 0, 0], np.int64),
                holders.copy(), draws, np.zeros(n, np.int64), np.zeros(capacity, np.bool_),
                np.zeros(capacity, np.int64), np.zeros(capacity),
                np.zeros((len(s.cfg), len(s.cfg))), settings,
                np.empty((len(s.cfg)**2, capacity), np.int64),
                np.zeros(len(s.cfg)**2, np.int64), np.full(capacity, -1, np.int64),
                np.zeros((len(s.cfg), len(s.cfg)), np.bool_))
    for h in range(n):
        r.control[0] = push(r.heap, r.control[0], settings[0], holders[h, 7], 1, h, 1, h, -1)
    r.control[0] = push(r.heap, r.control[0], settings[0], clock[0], 0, n, 0, 0, -1)
    ticks, prices, confs, stamps = history
    while r.control[0]:
        event, count = pop(r.heap, r.control[0])
        r.control[0] = count
        now, kind, h, i = event[0], int(event[3]), int(event[4]), int(event[5])
        s.meta[0] = settings[1]+now
        k = np.searchsorted(ticks, now+1e-12, side='right')-1
        for t in range(len(s.prices)):
            s.prices[t] = prices[t, k]*1e8, confs[t, k]*1e8, -8., settings[1]+stamps[t, k], 0.
        if kind == 0:
            scan(s, r, now, threshold_nb)
            next_action = r.heap[0, 0] if r.control[0] else np.inf
            j = next_oracle(clock, h, now, next_action, windows, r.tops, s.prices)
            r.control[2] += j-h-1
            r.control[4] += j-h-1
            if j < len(clock):
                r.control[0] = push(r.heap, r.control[0], settings[0], clock[j], 0, n+j, 0, j, -1)
        elif kind == 1 or kind == 6:
            open_holder(s, r, h, now, params, terms, open_nb, threshold_nb, logs)
        else:
            action(s, r, kind, h, i, now, params, terms, open_nb, threshold_nb, logs)
        r.control[2] += 1
    return r.control[2:5]


@njit(parallel=True)
def run_batch(jobs, tapes, stats, open_nb, threshold_nb):
    for index in prange(len(jobs)):
        path = np.int64(index)
        s, h, draws, params, terms, settings, clock, history, windows = jobs[path]
        stats[path] = run_path(s, h, draws, params, terms, settings, clock, history, windows,
                               open_nb, threshold_nb, tapes[path])
