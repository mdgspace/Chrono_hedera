"""Soft SP routing and debt-first hard-liquidation waterfall."""
import math
import numpy as np
from numba import njit
from .precision import floor_mul_div
from .math import WAD, MAX, checked, wm, wd, ltv
from .state import *
from .pools import accrue, clear, transfer, can_absorb, absorb, return_liquidity
from .vault import active, value, price, risk_prices, collateral_for, debt_ledger, split, seize
from .vault import risk_prices_core, value_core


@njit
def health_core(positions, prices, meta, cfg, params, switches, i, total, pc, pd, threshold_nb):
    p = positions[i]
    coll, debt = int(p[COLL]), int(p[DEBT])
    if switches[5]:
        pc, pd = risk_prices_core(prices, meta, switches, coll, debt)
    dv = value_core(cfg, switches, debt, total, pd)
    if dv == 0:
        return MAX
    remaining = max(0.0, p[START]+p[TERM]-meta[0])
    elapsed = checked(meta[0]-p[START])
    if switches[3] and not switches[0]:
        ltv(cfg[coll], remaining)
    if switches[3]:
        lt = threshold_nb(params[i], remaining, elapsed)*WAD
    elif switches[0]:
        lt = meta[9]*WAD
    else:
        row = cfg[coll]
        buf = row[5]+wm(row[6]-row[5], WAD-np.floor(WAD*math.exp(-row[7]*elapsed/WAD)))
        lt = min(checked(ltv(row, remaining)+buf), WAD)
    return wd(wm(value_core(cfg, switches, coll, p[C], pc), lt), dv)


@njit(inline='always')
def health(s, i, total, pc, pd, threshold_nb):
    return health_core(s.positions, s.prices, s.meta, s.cfg, s.params, s.switches, i, total, pc, pd, threshold_nb)


@njit
def soft(s, i, amount, actor, threshold_nb):
    active(s, i)
    delta = accrue(s, i)
    p = s.positions[i]
    principal, delta = debt_ledger(s, i, delta)
    total = checked(principal+delta)
    coll, debt, n = int(p[COLL]), int(p[DEBT]), len(s.balances[0])
    pc, pd = price(s, coll), price(s, debt)
    hf = health(s, i, total, pc, pd, threshold_nb)
    if hf > WAD:
        raise ValueError(2)
    bonus = p[BONUS] if s.switches[3] else s.cfg[coll, 3]
    cf = p[CLOSE] if s.switches[3] else s.cfg[debt, 4]
    amount = min(amount, wm(total, cf))
    if amount == 0:
        raise ValueError(6)
    collateral = min(collateral_for(s, coll, debt, amount, pc, pd, WAD+bonus), p[C])
    close = amount == total
    if can_absorb(s, debt, amount):
        absorb(s, debt, amount, coll, collateral)
        transfer(s, debt, n-1, n-4, amount)
        recipient = n-3
    else:
        transfer(s, debt, actor, n-4, amount)
        recipient = actor
    seize(s, i, recipient, collateral, 0, close, close)
    paid, _ = split(principal, delta, amount)
    if paid:
        return_liquidity(s, debt, paid)
    if s.switches[1]:
        p[B] = checked(principal-paid)
    if close:
        clear(s, i)
    else:
        remaining = checked(principal-checked(amount-delta)) if amount >= delta else principal
        p[PRINCIPAL], p[ACCRUED] = remaining, 0 if amount >= delta else checked(delta-amount)


@njit
def tranches(s, i, total, pc, pd):
    p = s.positions[i]
    coll, debt = int(p[COLL]), int(p[DEBT])
    cfg = s.cfg[debt]
    dv, cv = value(s, debt, total, pd), value(s, coll, p[C], pc)
    penalty_rate, floor, share = (p[PENALTY], p[FLOOR], p[SHARE]) if s.switches[3] else (cfg[8], cfg[9], cfg[10])
    penalty = max(wm(dv, penalty_rate), wm(cv, floor))
    debt_coll = collateral_for(s, coll, debt, total, pc, pd)
    pen_coll = floor_mul_div(penalty, 10.0**s.cfg[coll, 14], pc) if s.switches[2] else wd(penalty, pc)
    required = checked(debt_coll+pen_coll)
    if required > p[C]:
        required = p[C]
        debt_coll = min(debt_coll, required)
        pen_coll = checked(required-debt_coll)
    sp_pen = wm(pen_coll, share)
    return required, checked(debt_coll+sp_pen), checked(pen_coll-sp_pen)


@njit
def hard(s, i):
    if i < 0 or i >= len(s.positions) or not s.positions[i, ACTIVE]:
        return
    p = s.positions[i]
    if s.meta[0] < p[START]+p[TERM]+900:
        raise ValueError(2)
    delta = accrue(s, i)
    principal, delta = debt_ledger(s, i, delta)
    total = checked(principal+delta)
    coll, debt, n = int(p[COLL]), int(p[DEBT]), len(s.balances[0])
    pc, pd = price(s, coll), price(s, debt)
    if s.switches[4] and p[C] == 0:
        residual = min(p[PRINCIPAL], s.lp[debt, 0])
        if residual:
            return_liquidity(s, debt, residual)
        seize(s, i, 0, 0, 0, True, False)
        clear(s, i)
        return
    required, sp_coll, reserve = tranches(s, i, total, pc, pd)
    if can_absorb(s, debt, total):
        absorb(s, debt, total, coll, sp_coll)
        transfer(s, debt, n-1, n-4, total)
        return_liquidity(s, debt, p[B])
        seize(s, i, n-3, sp_coll, reserve, True, True)
    else:
        return_liquidity(s, debt, p[B])
        seize(s, i, 0, required, 0, True, False)
    clear(s, i)
