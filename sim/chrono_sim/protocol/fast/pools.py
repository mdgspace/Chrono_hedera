"""Numba lending shares, scaled Stability Pool and lazy interest."""
import math
import numpy as np
from numba import njit
from .math import WAD, YEAR, checked, wm, wd, ratio, kink
from .precision import wm_pair, wd_pair, add_pair
from .state import DEBT, PRINCIPAL, ACCRUED, LAST, IA


@njit
def transfer(s, token, source, target, amount):
    if s.balances[token, source] < amount:
        raise ValueError(5)
    s.flows[token, source, target] += amount
    s.balances[token, source] = checked(s.balances[token, source]-amount)
    s.balances[token, target] = checked(s.balances[token, target]+amount)


@njit
def apy_core(cfg, lp, balances, token):
    return kink(cfg[token, 15], lp[token, 0], lp[token, 0]+balances[token, -4])


@njit(inline='always')
def apy(s, token):
    return apy_core(s.cfg, s.lp, s.balances, token)


@njit
def accrual_delta(s, i):
    p = s.positions[i]
    if not p[IA] or s.meta[0] <= p[LAST]:
        return 0.0
    debt = checked(p[PRINCIPAL]+p[ACCRUED])
    x = np.floor(checked(apy(s, int(p[DEBT]))*(s.meta[0]-p[LAST]))/YEAR)/WAD
    if x > 133:
        raise ValueError(1)
    return checked(np.floor(debt*math.expm1(x)+0.5))


@njit
def accrue(s, i):
    delta = accrual_delta(s, i)
    p = s.positions[i]
    if p[IA] and s.meta[0] > p[LAST]:
        p[ACCRUED] = checked(p[ACCRUED]+delta)
        p[LAST] = s.meta[0]
    return delta


@njit
def clear(s, i):
    s.positions[i, PRINCIPAL:IA+1] = 0


@njit
def return_liquidity(s, token, amount):
    if amount == 0:
        raise ValueError(6)
    s.lp[token, 0] = checked(s.lp[token, 0]-amount)


@njit
def lending(s, token, actor, amount, receiver, withdraw):
    if amount == 0:
        raise ValueError(6)
    cash = s.balances[token, -4]
    total = checked(cash+s.lp[token, 0])
    shares = s.lp[token, 1]
    if withdraw:
        if s.lp_users[token, actor] < amount:
            raise ValueError(7)
        paid = ratio(checked(amount*total), shares)
        if paid == 0:
            raise ValueError(6)
        if paid > cash:
            raise ValueError(8)
        s.lp[token, 1] -= amount
        s.lp_users[token, actor] -= amount
        transfer(s, token, len(s.balances[0])-4, actor, paid)
    else:
        if not s.cfg[token, 16]:
            raise ValueError(9)
        minted = amount if shares == 0 or total == 0 else ratio(checked(amount*shares), total)
        if minted == 0:
            raise ValueError(6)
        s.lp[token, 1] = checked(shares+minted)
        s.lp_users[token, receiver] = checked(s.lp_users[token, receiver]+minted)
        transfer(s, token, actor, len(s.balances[0])-4, amount)


@njit
def rewards(s, token, actor):
    for coll in range(len(s.cfg)):
        hi, lo = add_pair(s.cumulative[token, coll], s.cumulative_low[token, coll],
                          -s.seen[token, actor, coll], -s.seen_low[token, actor, coll])
        if s.absorbed[token, coll] and hi+lo > 0:
            rh, rl = wm_pair(s.sp_users[token, actor], hi, 0., lo)
            s.pending[token, actor, coll] = checked(s.pending[token, actor, coll]+rh+rl)
            s.seen[token, actor, coll] = s.cumulative[token, coll]
            s.seen_low[token, actor, coll] = s.cumulative_low[token, coll]


@njit
def stability(s, token, actor, amount, withdraw):
    if amount == 0:
        raise ValueError(6)
    if s.sp[token, 0] == 0:
        s.sp[token, 0], s.sp[token, 2] = WAD, 0
    rewards(s, token, actor)
    hi, lo = wd_pair(amount, s.sp[token, 0], 0., s.sp[token, 2])
    scaled = hi+lo
    if withdraw:
        if scaled > s.sp_users[token, actor]:
            scaled = s.sp_users[token, actor]
            hi, lo = wm_pair(scaled, s.sp[token, 0], 0., s.sp[token, 2])
            amount = hi+lo
        s.sp[token, 1] = checked(s.sp[token, 1]-scaled)
        s.sp_users[token, actor] = checked(s.sp_users[token, actor]-scaled)
        transfer(s, token, len(s.balances[0])-3, actor, amount)
    else:
        s.sp[token, 1] = checked(s.sp[token, 1]+scaled)
        s.sp_users[token, actor] = checked(s.sp_users[token, actor]+scaled)
        transfer(s, token, actor, len(s.balances[0])-3, amount)


@njit
def can_absorb(s, token, amount):
    hi, lo = wm_pair(s.sp[token, 1], s.sp[token, 0], 0., s.sp[token, 2])
    return s.sp[token, 0] != 0 and hi+lo >= amount


@njit
def absorb(s, token, amount, coll, collateral):
    if amount == 0 or collateral == 0:
        raise ValueError(6)
    th, tl = wm_pair(s.sp[token, 1], s.sp[token, 0], 0., s.sp[token, 2])
    total = th+tl
    if total < amount:
        raise ValueError(7)
    s.absorbed[token, coll] = 1
    dh, dl = wd_pair(collateral, s.sp[token, 1])
    hi, lo = add_pair(s.cumulative[token, coll], s.cumulative_low[token, coll], dh, dl)
    s.cumulative[token, coll] = checked(hi)
    s.cumulative_low[token, coll] = lo
    s.sp[token, 0], s.sp[token, 2] = wd_pair(checked(total-amount), s.sp[token, 1])
    transfer(s, token, len(s.balances[0])-3, len(s.balances[0])-1, amount)


@njit
def claim(s, token, actor):
    rewards(s, token, actor)
    for coll in range(len(s.cfg)):
        amount = s.pending[token, actor, coll]
        if s.absorbed[token, coll] and amount:
            s.pending[token, actor, coll] = 0
            transfer(s, coll, len(s.balances[0])-3, actor, amount)


@njit
def index(s, token):
    if s.indices[token, 0] == 0:
        s.indices[token] = WAD, s.meta[0]
    else:
        factor = np.floor(checked(apy(s, token)*(s.meta[0]-s.indices[token, 1]))/YEAR)
        s.indices[token, 0] = checked(s.indices[token, 0]+wm(s.indices[token, 0], factor))
        s.indices[token, 1] = s.meta[0]
