"""Opening, repayment, collateral custody and scheduler kernels."""
import math
import numpy as np
from numba import njit
from chrono_sim.models.kernels import interpolate
from .precision import wm_pair, wd_pair, floor_seizure
from .math import WAD, checked, wm, wd, ltv
from .pools import transfer, apy, accrue, clear, return_liquidity
from .state import C, B, START, TERM, ACTIVE, COLL, DEBT, OWNER, PRINCIPAL, ACCRUED, LAST, IA, SCHEDULE
from .state import BONUS, CLOSE, PENALTY, FLOOR, SHARE, LT


# Kernels on the arrays they read, each with a State wrapper the JIT inlines: a call that passes the State
# NamedTuple pays a refcount per member array, so hot callers use the array forms (P3C_ENGINE_REPORT.md).
@njit
def price_core(prices, meta, token):
    p = prices[token]
    if meta[2]:
        return p[0]
    if checked(p[3]+120) < meta[0]:
        raise ValueError(10)
    if p[0] < 0:
        raise ValueError(11)
    expo = p[2]
    if expo == -(2**31) or abs(expo+18) > 77:
        raise ValueError(1)
    return checked(p[0]*10.0**(18+expo)) if expo >= -18 else np.floor(p[0]/10.0**(-expo-18))


@njit(inline='always')
def price(s, token):
    return price_core(s.prices, s.meta, token)


@njit
def risk_prices_core(prices, meta, switches, coll, debt, opening=False):
    pc, pd = price_core(prices, meta, coll), price_core(prices, meta, debt)
    if not switches[5]:
        return pc, pd
    cc = prices[coll, 1]*10.0**(18+prices[coll, 2])
    cd = prices[debt, 1]*10.0**(18+prices[debt, 2])
    if opening and (cc > meta[8]*pc or cd > meta[8]*pd):
        raise ValueError(12)
    return max(0.0, pc-meta[7]*cc), pd+meta[7]*cd


@njit(inline='always')
def risk_prices(s, coll, debt, opening=False):
    return risk_prices_core(s.prices, s.meta, s.switches, coll, debt, opening)


@njit
def value_core(cfg, switches, token, amount, p):
    return np.floor(amount*p/10.0**cfg[token, 14]) if switches[2] else wm(amount, p)


@njit(inline='always')
def value(s, token, amount, p):
    return value_core(s.cfg, s.switches, token, amount, p)


@njit
def collateral_for(s, coll, debt, amount, pc, pd, multiplier=WAD):
    if not s.switches[2]:
        return wd(wm(wm(amount, pd), multiplier), pc)
    if pc == 0:
        raise ValueError(2)
    return floor_seizure(amount, pd, multiplier, 10.0**(s.cfg[coll, 14]-s.cfg[debt, 14]), pc)


@njit
def active(s, i):
    if i < 0 or i >= len(s.positions) or not s.positions[i, ACTIVE]:
        raise ValueError(13)


@njit
def schedule(s, i, expiry, capacity):
    if s.meta[3]:
        raise ValueError(14)
    if capacity < 0:
        s.positions[i, SCHEDULE] = expiry
        return
    for second in range(int(expiry+902), int(expiry+908)):
        used = 0
        for j in range(i):
            if s.schedules[j, 0] == second:
                used += s.schedules[j, 1]
        if used < capacity:
            s.schedules[i, 0], s.schedules[i, 1] = second, 1
            s.positions[i, SCHEDULE] = second
            return
    raise ValueError(14)


@njit
def open_position(s, coll, debt, c, b, duration, actor, owner, params, terms, open_nb, capacity):
    if not s.cfg[coll, 16] or not s.cfg[debt, 16]:
        raise ValueError(9)
    if c == 0 or b == 0:
        raise ValueError(6)
    if duration > 60*86400:
        raise ValueError(15)
    maximum = 0.0
    if s.switches[3]:
        if duration < terms[6] or duration > terms[7]:
            raise ValueError(4)
        if s.meta[6]:
            raise ValueError(16)
        maximum = open_nb(params, duration, s.meta[5], apy(s, debt)/WAD)*WAD
    else:
        maximum = ltv(s.cfg[coll], duration)
    pc, pd = risk_prices(s, coll, debt, True)
    if wd(value(s, debt, b, pd), value(s, coll, c, pc)) > maximum:
        raise ValueError(17)
    if b > s.balances[debt, -4]:
        raise ValueError(8)
    i = int(s.meta[1])-1
    if i >= len(s.positions):
        raise ValueError(18)
    n = len(s.balances[0])
    transfer(s, coll, actor, n-2, c)
    s.lp[debt, 0] = checked(s.lp[debt, 0]+b)
    transfer(s, debt, n-4, n-2, b)
    transfer(s, debt, n-2, actor, b)
    p = s.positions[i]
    p[C], p[B], p[START], p[TERM], p[ACTIVE] = c, b, s.meta[0], duration, 1
    p[COLL], p[DEBT], p[OWNER] = coll, debt, owner
    p[PRINCIPAL], p[ACCRUED], p[LAST], p[IA] = b, 0, s.meta[0], 1
    p[BONUS:LT+1] = terms[:6]
    s.params[i, :len(params)] = params
    schedule(s, i, s.meta[0]+duration, capacity)
    if s.switches[3] and params[0] == 2:
        premium(s, i, params, terms, c, b, pc, pd, duration, actor)
    s.meta[1] += 1


@njit
def split(principal, accrued, amount):
    paid = principal if amount >= principal+accrued else amount-accrued if amount > accrued else 0.0
    return paid, checked(amount-paid)


@njit
def debt_ledger(s, i, delta):
    p = s.positions[i]
    return (p[PRINCIPAL], p[ACCRUED]) if s.switches[1] else (p[B], delta)


@njit
def repay(s, i, amount, actor):
    if amount == 0:
        raise ValueError(6)
    active(s, i)
    delta = accrue(s, i)
    p = s.positions[i]
    principal, delta = debt_ledger(s, i, delta)
    total = checked(principal+delta)
    token, coll, n = int(p[DEBT]), int(p[COLL]), len(s.balances[0])
    if p[START]+p[TERM] < s.meta[0] <= p[START]+p[TERM]+900:
        transfer(s, token, actor, 0, wm(total, 0.015*WAD))
    amount = min(amount, total)
    principal_paid, paid_interest = split(principal, delta, amount)
    fee = np.floor(checked(paid_interest*(WAD/10))/WAD)
    transfer(s, token, actor, 0, fee)
    transfer(s, token, actor, n-4, checked(amount-fee))
    if principal_paid:
        return_liquidity(s, token, principal_paid)
    if amount == total:
        c = p[C]
        p[C], p[B], p[ACTIVE] = 0, 0, 0
        clear(s, i)
        transfer(s, coll, n-2, int(p[OWNER]), c)
        s.schedules[i, 1] = 0
    else:
        if amount >= delta:
            p[B] = checked(p[B]-principal_paid)
        p[PRINCIPAL], p[ACCRUED] = p[B], 0 if amount >= delta else checked(delta-amount)


@njit
def top_up(s, i, amount, actor):
    if amount == 0:
        raise ValueError(6)
    active(s, i)
    p = s.positions[i]
    transfer(s, int(p[COLL]), actor, len(s.balances[0])-2, amount)
    p[C] = checked(p[C]+amount)


@njit
def seize(s, i, recipient, liquidator, reserve, close, refund):
    active(s, i)
    p = s.positions[i]
    total = checked(liquidator+reserve)
    if total > p[C]:
        total = p[C]
        liquidator = min(liquidator, total)
        reserve = checked(total-liquidator)
    # Match custody's two debits so a rounded refund cannot exceed its balance.
    p[C] = checked(checked(p[C]-liquidator)-reserve)
    coll, n = int(p[COLL]), len(s.balances[0])
    transfer(s, coll, n-2, recipient, liquidator)
    transfer(s, coll, n-2, 0, reserve)
    if close:
        p[ACTIVE] = 0
        if refund and p[C]:
            transfer(s, coll, n-2, int(p[OWNER]), p[C])
            p[C] = 0


@njit
def premium(s, i, params, terms, c, b, pc, pd, duration, actor):
    p = s.positions[i]
    coll, debt = int(p[COLL]), int(p[DEBT])
    requested = wd(value(s, debt, b, pd), value(s, coll, c, pc))/WAD
    annual = interpolate(requested, params[40:48], params[48:56])
    fraction = max(0., annual-params[21])*max(duration, params[22])/31536000.
    amount = np.rint(b*fraction)
    share = wm(amount, terms[4])
    transfer(s, debt, actor, len(s.balances[0])-3, share)
    transfer(s, debt, actor, 0, amount-share)
    if s.sp[debt, 1] and share:
        hi, lo = wm_pair(s.sp[debt, 1], s.sp[debt, 0], 0., s.sp[debt, 2])
        s.sp[debt, 0], s.sp[debt, 2] = wd_pair(hi+lo+share, s.sp[debt, 1])
