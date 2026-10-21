"""Event-based Pyth state, one heartbeat window at a time, with the P3b push rule (P3C_METHOD.md 2, 7).

At every evaluation tick (publication of a 1 s observation, keeper availability change, or an
asset's heartbeat due time) an available keeper pushes asset `a` when `now - published_a >= H` or
the latest published observation deviates from the stored price by at least `deviation`, exactly
as `engine/native_oracle.publish`. The heartbeat therefore runs per asset from its last push, so
windows are built in time order from the previous window's end state.
"""
import math
import numpy as np
from numba import njit
from chrono_sim.market import band
from chrono_sim.market.keyed import reseed


@njit(inline='always')
def pub(s, cadence):
    """Publication tick of the observation at second s, snapped to s when they coincide."""
    u = math.ceil(s/cadence-1e-12)*cadence
    return float(s) if abs(u-s) < 1e-9 else u


@njit(inline='always')
def keeper_up(changes, up, t):
    return up[np.searchsorted(changes, t, side='right')-1]


@njit
def availability_ticks(changes, cadence, start, stop):
    ticks = np.empty(len(changes))
    m = 0
    for c in changes:
        u = math.ceil(c/cadence)*cadence
        if start <= u < stop:
            ticks[m] = u
            m += 1
    return ticks[:m]


@njit
def push(state, a, price, frac, u):
    state[0, a], state[1, a], state[2, a] = price, price*frac, u


@njit
def window_tape(start, stop, cadence, deviation, heartbeat, obs, conf, n_obs, changes, up, enter,
                out_t, out_v, out_scan):
    """Fill tape columns from `enter` (stored price, absolute conf, publish time per asset); return m.

    obs[a, j] is the log price observed at second start+j (j < n_obs). Entries are the merged
    integer seconds, publication ticks, availability ticks and heartbeat due ticks in [start, stop);
    out_scan marks the P3b scan clock (integer seconds and publication ticks).
    """
    state, n = enter.copy(), obs.shape[0]
    extra = availability_ticks(changes, cadence, start, stop)
    j, js, x, m, latest, previous = 0, 0, 0, 0, -1, -np.inf
    while True:
        due = np.inf
        for a in range(n):
            d = math.ceil((state[2, a]+heartbeat)/cadence-1e-12)*cadence
            if d > previous+1e-9:
                due = min(due, d)
        u = min(pub(start+j, cadence) if j < n_obs else np.inf, float(start+js) if js < n_obs else np.inf,
                extra[x] if x < len(extra) else np.inf, due)
        if u >= stop:
            break
        scan = False
        while j < n_obs and pub(start+j, cadence) <= u+1e-9:
            latest, j, scan = j, j+1, True
        while js < n_obs and start+js <= u+1e-9:
            js, scan = js+1, True
        while x < len(extra) and extra[x] <= u+1e-9:
            x += 1
        if u <= previous+1e-9:
            continue
        previous = u
        if latest >= 0 and keeper_up(changes, up, u):
            for a in range(n):
                p = math.exp(obs[a, latest])
                if u-state[2, a] >= heartbeat-1e-12 or abs(p/state[0, a]-1.) >= deviation:
                    push(state, a, p, conf[a, latest], u)
        out_t[m], out_scan[m] = u, scan
        out_v[:, :, m] = state
        m += 1
    return m


# Band oracle (P3C_ORACLE_SAMPLER_DESIGN.md section 4): per asset, the next push after a push is computed
# from revealed nodes only, with P3b evaluation ticks (publications, availability changes, queued due ticks).
# The kernels take explicit arrays rather than the view tuple: every tuple field access costs an atomic
# reference count in numba, which dominated the per-window cost.
STORE, RING = 64, 8


@njit(inline='always')
def latest_second(u, cadence, last):
    """Latest integer second published by tick u (the source of a push at u), capped at the last observation."""
    s = min(int(math.floor(u+1e-9)), last)
    while s > 0 and pub(s, cadence) > u+1e-9:
        s -= 1
    return s


@njit(inline='always')
def is_tick(u, cadence, avail, ring, ring_n):
    """True if u is a P3b evaluation tick: a publication, an availability change or a queued due tick."""
    if pub(int(math.floor(u)), cadence) == u:
        return True
    i = np.searchsorted(avail, u)
    if i < len(avail) and avail[i] == u:
        return True
    for r in range(min(ring_n, RING)):
        if ring[r] == u:
            return True
    return False


@njit(inline='always')
def heartbeat_tick(p, H, cadence, changes, up, avail, ring, ring_n):
    """First evaluation tick u with u - p >= H (P3b float test) and the keeper up, else inf.

    The due tick d = ceil((p + H)/c) c can round one cadence step late; the grid point before it is then
    a heartbeat tick whenever some other rule evaluates there (native_oracle.history)."""
    n = math.ceil((p+H)/cadence-1e-12)
    d, g = n*cadence, (n-1)*cadence
    if g > p and g-p >= H-1e-12 and is_tick(g, cadence, avail, ring, ring_n) and keeper_up(changes, up, g):
        return g
    if keeper_up(changes, up, d):
        return d
    for i in range(np.searchsorted(avail, d, side='right'), len(avail)):
        if keeper_up(changes, up, avail[i]):
            return avail[i]
    return np.inf


@njit(inline='always')
def monitored_seconds(p, q, sp, last, cadence, changes, up, iv):
    """Inclusive ranges of seconds s in (sp, last] with p < pub(s) < q and the keeper up at pub(s); returns count."""
    first, final = sp+1, last
    while final >= first and pub(final, cadence) >= q-1e-9:
        final -= 1
    while first <= final and pub(first, cadence) <= p+1e-9:
        first += 1
    if first > final:
        return 0
    a, b = pub(first, cadence), pub(final, cadence)
    j = np.searchsorted(changes, a, side='right')
    if j >= len(changes) or changes[j] > b:
        if not keeper_up(changes, up, a):
            return 0
        iv[0, 0], iv[0, 1] = first, final
        return 1
    n = 0
    for s in range(first, final+1):
        if keeper_up(changes, up, pub(s, cadence)):
            if n and iv[n-1, 1] == s-1:
                iv[n-1, 1] = s
            else:
                if n >= iv.shape[0]:
                    raise RuntimeError('band monitored-range capacity exceeded')
                iv[n, 0], iv[n, 1] = s, s
                n += 1
    return n


@njit(inline='always')
def conf_frac(a, s, c0, c2, jump_t, jump_a):
    """Confidence fraction of the observation at second s (window_obs.mark_conf)."""
    for j in range(len(jump_t)):
        if jump_a[j] == a and math.ceil(jump_t[j]) <= s < math.ceil(jump_t[j]+60.):
            return c0+c2
    return c0


@njit(inline='always')
def store_insert(store, a, n, t, x):
    """Insert (t, x) into asset a's sorted store rows [:n]; returns the new count."""
    if n >= store.shape[1]:
        raise RuntimeError('band node store capacity exceeded')
    i = n
    while i > 0 and store[a, i-1, 0] > t:
        store[a, i, 0], store[a, i, 1] = store[a, i-1, 0], store[a, i-1, 1]
        i -= 1
    store[a, i, 0], store[a, i, 1] = t, x
    return n+1


@njit(inline='always')
def store_drop(store, a, n, t):
    """Forget asset a's stored nodes at or before t (the new frontier); returns the new count."""
    k = 0
    while k < n and store[a, k, 0] <= t:
        k += 1
    for i in range(n-k):
        store[a, i, 0], store[a, i, 1] = store[a, i+k, 0], store[a, i+k, 1]
    return n-k


@njit(inline='always')
def neighbours(t, ft, fx, t0, t1, x0, x1, store, a, n):
    """(left time, left value, right time, right value, known value or nan) of asset a's revealed nodes around t."""
    g = max(0, np.searchsorted(t0, t, side='right')-1)
    if t == t0[g]:
        return t, x0[a, g], t, x0[a, g], x0[a, g]
    if t == t1[g]:
        return t, x1[a, g], t, x1[a, g], x1[a, g]
    lt, lx, rt, rx = t0[g], x0[a, g], t1[g], x1[a, g]
    if ft >= lt:
        lt, lx = ft, fx
    for i in range(n):
        ti = store[a, i, 0]
        if ti == t:
            return t, store[a, i, 1], t, store[a, i, 1], store[a, i, 1]
        if lt < ti < t:
            lt, lx = ti, store[a, i, 1]
        elif t < ti < rt:
            rt, rx = ti, store[a, i, 1]
    return lt, lx, rt, rx, np.nan


@njit(inline='always')
def next_node(ta, t0, t1, x0, x1, store, a, n):
    """(time, value as an end, value as a start) of asset a's first revealed node after ta."""
    g = max(0, np.searchsorted(t0, ta, side='right')-1)
    tb, xb = t1[g], x1[a, g]
    post = x0[a, g+1] if g+1 < len(t0) else xb
    for i in range(n):
        ti = store[a, i, 0]
        if ti > ta:
            if ti < tb:
                return ti, store[a, i, 1], store[a, i, 1]
            break
    return tb, xb, post


@njit
def band_window(a, p, sp, y, cfg, key, sig, t0, t1, x0, x1, jump_t, jump_a, changes, up, avail, ring, ring_n,
                iv, rec, store, sn, trace, tn, rng, out, counts, pend):
    """Next push (tick, second, log value, conf fraction) of moving asset a after its push at tick p that stored
    x(sp) = y, into pend[a]; sn[a] counts asset a's stored nodes and rng[a] is its stream buffer.

    Reveals x(e) at the heartbeat source second and every recovery-tested second first, then walks the
    revealed nodes in time order deciding each run by band.first_exit (design section 4.1).
    """
    H, c, dev, horizon = cfg[0], cfg[2], cfg[3], cfg[4]
    end, last_obs = horizon+1e-9+1e-12*horizon, int(math.floor(horizon))
    q = heartbeat_tick(p, H, c, changes, up, avail, ring, ring_n)
    q = q if q < end else np.inf
    e = latest_second(q, c, last_obs) if q < np.inf else -1
    last = e if e >= 0 else latest_second(end, c, last_obs)
    n_iv = monitored_seconds(p, min(q, end), sp, last, c, changes, up, iv)
    st = reseed(rng[a], key, a, sp, band.LEVEL_BAND, 0)
    s2, ft, n = sig[a]*sig[a], float(sp), sn[a]
    xe = np.nan
    if e >= 0:
        lt, lx, rt, rx, xe = neighbours(float(e), ft, y, t0, t1, x0, x1, store, a, n)
        if xe != xe:
            xe = band.bridge_value(lt, lx, rt, rx, float(e), s2, st)
            n = store_insert(store, a, n, float(e), xe)
            band.record(trace, tn, a, float(e), xe)
    n_rec = 0
    if len(changes) > 1:
        for i in range(np.searchsorted(avail, p, side='right'), len(avail)):
            r = avail[i]
            if r >= min(q, end):
                break
            sr = latest_second(r, c, last_obs)
            if keeper_up(changes, up, r) and sr > sp and not band.monitored(sr, iv, n_iv) \
                    and not (n_rec and rec[n_rec-1, 0] == sr):
                if n_rec >= len(rec):
                    raise RuntimeError('band recovery-test capacity exceeded')
                lt, lx, rt, rx, xr = neighbours(float(sr), ft, y, t0, t1, x0, x1, store, a, n)
                if xr != xr:
                    xr = band.bridge_value(lt, lx, rt, rx, float(sr), s2, st)
                    n = store_insert(store, a, n, float(sr), xr)
                    band.record(trace, tn, a, float(sr), xr)
                rec[n_rec, 0], rec[n_rec, 1] = sr, r
                n_rec += 1
    stored, ta, xa, stop = math.exp(y), ft, y, float(e if e >= 0 else last)
    push_t, push_s, push_x = np.inf, -1, np.nan
    while True:
        tb, xb, post = next_node(ta, t0, t1, x0, x1, store, a, n)
        s = band.first_exit(ta, xa, tb, xb, y, stored, dev, s2, iv, n_iv, st, out, trace, tn, a, counts, 5)
        if s >= 0:
            push_t, push_s, push_x = pub(s, c), s, out[0]
            break
        if tb > stop:
            break
        if tb == math.floor(tb):
            sb = int(tb)
            if band.monitored(sb, iv, n_iv) and band.outside(xb, stored, dev):
                push_t, push_s, push_x = pub(sb, c), sb, xb
                break
            hit = False
            for i in range(n_rec):
                if rec[i, 0] == sb and band.outside(xb, stored, dev):
                    push_t, push_s, push_x, hit = rec[i, 1], sb, xb, True
                    break
            if hit or tb >= stop:
                break
        elif tb >= stop:
            break
        ta, xa = tb, post
    if push_s < 0 and e >= 0:
        push_t, push_s, push_x = q, e, xe
    pend[a, 0] = push_t
    if push_s >= 0:
        pend[a, 1], pend[a, 2], pend[a, 3] = push_s, push_x, conf_frac(a, push_s, cfg[6], cfg[7], jump_t, jump_a)
        n = store_drop(store, a, n, float(push_s))
    sn[a] = n


@njit
def stable_window(a, p, x, cfg, jump_t, jump_a, changes, up, avail, ring, ring_n, pend):
    """Next (heartbeat or recovery) push of a constant asset: its observations never deviate."""
    H, c, horizon = cfg[0], cfg[2], cfg[4]
    q = heartbeat_tick(p, H, c, changes, up, avail, ring, ring_n)
    if q >= horizon+1e-9+1e-12*horizon:
        pend[a, 0] = np.inf
        return
    s = latest_second(q, c, int(math.floor(horizon)))
    pend[a, 0], pend[a, 1], pend[a, 2], pend[a, 3] = q, s, x, conf_frac(a, s, cfg[6], cfg[7], jump_t, jump_a)
