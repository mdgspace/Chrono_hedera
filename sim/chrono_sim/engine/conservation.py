"""Incremental, bit-exact replay of `Engine.check_conservation` over a native action log.

The per-action full check scanned the whole position table (every row ever opened), so I5
collection cost grew with logged actions times book rows. Between two logged actions only the
touched row changes, so its row term and debt-token membership are updated in place; the
balance term uses that action's full balances. The claim sum is recomputed exactly as numpy
does (identity plus pairwise_sum over active rows in row order), so `conservation_error` keeps
every bit. The running maximum is exact because max is order independent; any action whose
old full check would raise also fails here, at the same logged-action index (NaN fails too).
"""
import numpy as np
from numba import njit
from chrono_sim.protocol.fast.state import B, ACTIVE, DEBT, PRINCIPAL

LIMIT = 1e-9


@njit(cache=True)
def _block(a, lo, n):
    # numpy/_core/src/umath/loops_utils.h.src pairwise_sum leaf: n < 8 sequential, else 8 accumulators.
    if n < 8:
        res = 0.
        for k in range(n):
            res += a[lo+k]
        return res
    r0, r1, r2, r3 = a[lo], a[lo+1], a[lo+2], a[lo+3]
    r4, r5, r6, r7 = a[lo+4], a[lo+5], a[lo+6], a[lo+7]
    i = 8
    while i < n-n % 8:
        j = lo+i
        r0 += a[j]
        r1 += a[j+1]
        r2 += a[j+2]
        r3 += a[j+3]
        r4 += a[j+4]
        r5 += a[j+5]
        r6 += a[j+6]
        r7 += a[j+7]
        i += 8
    res = ((r0+r1)+(r2+r3))+((r4+r5)+(r6+r7))
    while i < n:
        res += a[lo+i]
        i += 1
    return res


@njit(cache=True)
def _half(n):
    n2 = n//2
    return n2-n2 % 8


@njit(cache=True)
def pairwise_sum(a, n):
    """Bit-identical to `a[:n].sum()` for contiguous float64 (add.reduce starts at identity 0).

    numpy splits blocks above 128 at `_half` and returns left + right; this walks the same tree
    with an explicit stack, because numba's on-disk cache of a self-recursive function crashes
    when reloaded (an access violation on Windows).
    """
    lo, size = np.zeros(64, np.int64), np.zeros(64, np.int64)
    right, left = np.zeros(64, np.bool_), np.zeros(64)
    top, size[0] = 0, n
    while True:
        if size[top] > 128:
            h = _half(size[top])
            lo[top+1], size[top+1], right[top+1] = lo[top], h, False
            top += 1
            continue
        value = _block(a, lo[top], size[top])
        while top > 0 and right[top]:
            top -= 1
            value = left[top]+value
        if top == 0:
            return 0.+value
        left[top-1] = value
        h = _half(size[top-1])
        lo[top], size[top], right[top] = lo[top-1]+h, size[top-1]-h, True


@njit(cache=True)
def _token(row, n_tokens):
    if row[ACTIVE] == 0:
        return -2
    for t in range(n_tokens):
        if row[DEBT] == t:
            return t
    return -1


@njit(cache=True)
def _relink(members, counts, owner, i, token):
    old = owner[i]
    if old == token:
        return
    if old >= 0:
        c = counts[old]
        k = np.searchsorted(members[old, :c], i)
        members[old, k:c-1] = members[old, k+1:c].copy()
        counts[old] = c-1
    if token >= 0:
        c = counts[token]
        k = np.searchsorted(members[token, :c], i)
        members[token, k+1:c+1] = members[token, k:c].copy()
        members[token, k] = i
        counts[token] = c+1
    owner[i] = token


@njit(cache=True)
def _row_error(row):
    return abs(row[B]-row[PRINCIPAL])/max(1., row[PRINCIPAL])


@njit(cache=True)
def _action_error(balances, lp, rows, members, counts, values, initial_tokens, fix):
    error = 0.
    for t in range(len(initial_tokens)):
        total = pairwise_sum(np.ascontiguousarray(balances[t]), balances.shape[1])
        error = max(error, abs(total-initial_tokens[t])/max(1., initial_tokens[t]))
        if fix:
            c = counts[t]
            for k in range(c):
                values[k] = rows[members[t, k], PRINCIPAL]
            expected = pairwise_sum(values, c)
            error = max(error, abs(lp[t, 0]-expected)/max(1., abs(expected)))
    return error


@njit(cache=True)
def scan(logs, positions, initial_tokens, fix):
    """(max error, first violating logged-action index or -1, its partial error, checks run)."""
    rows, n_tokens = positions.copy(), len(initial_tokens)
    members = np.empty((n_tokens, len(rows)), np.int64)
    counts, owner = np.zeros(n_tokens, np.int64), np.full(len(rows), -2, np.int64)
    values = np.empty(len(rows))
    for i in range(len(rows)):
        _relink(members, counts, owner, i, _token(rows[i], n_tokens))
    worst, checks = 0., 0
    for k in range(len(logs)):
        item = logs[k]
        if item[0] == 7:
            continue
        i = item[1]
        rows[i] = item[4]
        _relink(members, counts, owner, i, _token(rows[i], n_tokens))
        error = _action_error(item[6], item[8], rows, members, counts, values, initial_tokens, fix)
        if fix:
            # Untouched active rows were included when last written (or at the first check).
            lo, hi = (0, len(rows)) if checks == 0 else (i, i+1)
            for r in range(lo, hi):
                if rows[r, ACTIVE] != 0:
                    error = max(error, _row_error(rows[r]))
        checks += 1
        if not error <= LIMIT or np.any(item[6] < 0):
            return worst, k, error, checks
        worst = max(worst, error)
    return worst, -1, 0., checks
