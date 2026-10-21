"""Native action boundary using the existing, unchanged protocol kernels."""
import math
import numpy as np
from numba import njit, literal_unroll
from chrono_sim.protocol.fast import vault, liquidation
from chrono_sim.protocol.fast.math import WAD, YEAR, ltv
from chrono_sim.protocol.fast.pools import apy, apy_core
from chrono_sim.protocol.fast.state import *

STATE_FIELDS = tuple(range(20))


@njit
def copy_state(s):
    return State(s.meta.copy(), s.cfg.copy(), s.prices.copy(), s.balances.copy(),
                 s.flows.copy(), s.lp.copy(), s.lp_users.copy(), s.sp.copy(), s.sp_users.copy(),
                 s.cumulative.copy(), s.cumulative_low.copy(), s.seen.copy(), s.seen_low.copy(),
                 s.pending.copy(), s.absorbed.copy(), s.indices.copy(), s.positions,
                 s.params, s.switches.copy(), s.schedules)


@njit
def restore_state(s, old):
    for i in literal_unroll(STATE_FIELDS):
        if i != 16 and i != 17 and i != 19:
            s[i][...] = old[i]


@njit
def opening(s, h, params, terms, open_nb, capacity):
    c, d = int(h[0]), int(h[1])
    if s.switches[3]:
        s.meta[7], s.meta[8] = h[10], h[11]
    pc, pd = vault.price(s, c), vault.price(s, d)
    limit = open_nb(params, h[3], np.nan, apy(s, d)/WAD) if s.switches[3] else ltv(s.cfg[c], h[3])/WAD
    if s.switches[5]:
        pc = max(0., pc-s.meta[7]*s.prices[c, 1]*1e10)
        pd += s.meta[7]*s.prices[d, 1]*1e10
    collateral = float(np.rint(h[2]*10.**s.cfg[c, 14]))
    unit = 10.**(s.cfg[d, 14]-s.cfg[c, 14]) if s.switches[2] else 1.
    borrow = float(np.trunc(collateral*pc/pd*h[4]*limit*unit))
    # Engine.open_position's origination gate precedes the mechanical kernel.
    if s.switches[3] and params[0] != 7:
        pc, pd = vault.price(s, c), vault.price(s, d)
        if s.meta[6] or pc <= 0 or pd <= 0:
            raise ValueError(16)
        if s.prices[c, 1]*1e10/pc > s.meta[8] or s.prices[d, 1]*1e10/pd > s.meta[8]:
            raise ValueError(16)
    vault.open_position(s, c, d, collateral, borrow, float(round(h[3])), 1, 1,
                        params, terms, open_nb, capacity)


@njit
def execute(s, kind, i, h, params, terms, open_nb, threshold_nb, capacity):
    if not 0 <= i < len(s.positions):
        raise RuntimeError('native position capacity exceeded')
    s.flows.fill(0.)
    old = copy_state(s)
    row, parameters, schedule = s.positions[i].copy(), s.params[i].copy(), s.schedules[i].copy()
    error = False
    try:
        if kind == 1:
            opening(s, h, params, terms, open_nb, capacity)
        elif kind == 2:
            vault.repay(s, i, 1e26, 1)
        elif kind == 3:
            liquidation.soft(s, i, 1e26, 3, threshold_nb)
        else:
            liquidation.hard(s, i)
    except Exception:
        error = True
    if error:
        restore_state(s, old)
        s.positions[i], s.params[i], s.schedules[i] = row, parameters, schedule
    return error, old, row


@njit
def refresh(s, i, barriers, base, max_conf, lam):
    p = s.positions[i]
    if not p[ACTIVE]:
        barriers[i] = 0.
        return
    c, d = int(p[COLL]), int(p[DEBT])
    units = 10.**(s.cfg[c, 14]-s.cfg[d, 14]) if s.switches[2] else 1.
    debt = max(p[B], p[PRINCIPAL]+p[ACCRUED])
    # Epoch-normalised keys let each scan bound interest only to its own bar.
    growth = math.exp(-1.075/YEAR*(p[LAST]-base))
    conf = max_conf if s.switches[5] else 0.
    barriers[i] = debt*units*growth/max(1e-20, p[C]*lam)*(1+conf)/max(1e-12, 1-conf)


@njit
def barrier_at(top, now):
    return top*math.exp(1.075/YEAR*now)*(1.+1e-12)


@njit
def eligible_core(positions, prices, meta, cfg, lp, balances, params, switches, i, threshold_nb):
    p = positions[i]
    d, c = int(p[DEBT]), int(p[COLL])
    rate = apy_core(cfg, lp, balances, d)/WAD/YEAR
    accrued = (p[PRINCIPAL]+p[ACCRUED])*math.expm1(rate*max(0., meta[0]-p[LAST]))
    total = p[PRINCIPAL]+p[ACCRUED]+accrued if switches[1] else p[B]+accrued
    result = False
    try:
        result = liquidation.health_core(positions, prices, meta, cfg, params, switches, i, total,
                                         vault.price_core(prices, meta, c), vault.price_core(prices, meta, d),
                                         threshold_nb) <= WAD
    except Exception:
        pass
    return result


@njit(inline='always')
def eligible(s, i, threshold_nb):
    return eligible_core(s.positions, s.prices, s.meta, s.cfg, s.lp, s.balances, s.params, s.switches, i,
                         threshold_nb)
