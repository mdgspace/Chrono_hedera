"""Pair setter rules and the selection section 2.2 solvency calculation.

lambda_EL is supplied by E4's M0 book-level LT frontier.
perpetual_cap and the S3 loss-rate table are supplied by E3's perpetual/rolling
loss-rate frontier; L_eq is solved in E5 under the reference debt-weighted term
mix (S1 capacity, using E2's borrower curves).
E1 supplies declustered oracle gaps, structural jumps remain policy inputs.
These are explicit inputs, never empirical claims inferred by this module.
"""
import math

import numpy as np

from .wad_math import to_wad

SHARED = {'S1', 'S2', 'S3', 'B0_cap', 'B0_eq', 'SPEC_star'}


def number(value, name, lo=0.0, hi=math.inf, strict=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(name)
    if not math.isfinite(value) or value > hi or (value <= lo if strict else value < lo):
        raise ValueError(name)
    return value


def solvency_bounds(pair):
    e = pair.extra
    b = number(e['b_max'], 'b_max', pair.bonus)
    pi = number(e['pi_max'], 'pi_max', pair.hard_penalty)
    g = number(e['gap_liq'], 'gap_liq')
    conf = number(e['mean_conf_frac'], 'mean_conf_frac', 0, 1)
    m = number(e['conf_multiplier'], 'conf_multiplier')
    jump = number(e['J_struct'], 'J_struct', 0, 1)
    floor = number(e['h_floor'], 'h_floor', 0, 1)
    el = number(e['lambda_EL'], 'lambda_EL', 0, 1, True)
    lam = min(el, math.exp(-g) * (1 - m * conf) / (1 + b),
              (1 - jump) / (1 + b), 1 / (1 + pi), 1 - floor)
    oracle_cap = pair.lam * math.exp(-number(e['gap_open'], 'gap_open'))
    perpetual = number(e['perpetual_cap'], 'perpetual_cap', 0, 1, True)
    return lam, min(oracle_cap, perpetual), oracle_cap


def table(e, xkey, ykey, decreasing=False):
    xs, ys = e[xkey], e[ykey]
    if len(xs) != 8 or len(ys) != 8:
        raise ValueError('Expected eight nodes')
    for x, y in zip(xs, ys):
        number(x, xkey)
        number(y, ykey, 0, 1 if decreasing else math.inf)
    if any(b <= a for a, b in zip(xs, xs[1:])):
        raise ValueError('Nodes must increase')
    if any((b > a if decreasing else b < a) for a, b in zip(ys, ys[1:])):
        raise ValueError('Non-monotone table')


def validate(pair, name):
    e = pair.extra
    if (not pair.coll or not pair.debt or e.get('tokens_registered', True) is not True
            or pair.coll not in e.get('registered_tokens', ())
            or pair.debt not in e.get('registered_tokens', ())):
        raise ValueError('Unregistered token')
    if pair.coll == pair.debt:
        raise ValueError('Same token')
    number(e['sigma'], 'Sigma', 0, 5, True)
    number(e['z'], 'Z', 0, 10, True)
    number(pair.lam, 'Not insurable', 0, 1, True)
    number(pair.bonus, 'Bonus', 0, 1)
    if pair.lam >= 1 or pair.lam * (1 + pair.bonus) >= 1:
        raise ValueError('Not insurable')
    number(pair.cap, 'Cap', 0, pair.lam, True)
    if pair.cap >= pair.lam:
        raise ValueError('Cap')
    number(pair.close_factor, 'Close factor', 0, 1, True)
    number(pair.sp_share, 'Penalty split', 0, 1)
    number(pair.reserve_share, 'Penalty split', 0, 1)
    if to_wad(pair.sp_share) + to_wad(pair.reserve_share) != 10**18:
        raise ValueError('Penalty split')
    number(pair.hard_penalty, 'Hard penalty', 0, 1)
    number(pair.hard_floor, 'Hard floor', 0, 1)
    number(pair.min_T_s, 'Duration', 0, 60 * 86400, True)
    number(pair.max_T_s, 'Duration', pair.min_T_s, 60 * 86400)
    number(e['conf_multiplier'], 'Confidence multiplier')
    number(e['max_open_conf_ratio'], 'Open confidence', 0, 1)
    if name in SHARED:
        validate_shared(pair, name)
    if name in {'S1', 'S2', 'S3'}:
        validate_term(e)
    if name in {'B0_cap', 'B0_eq'}:
        number(e['r_max'], 'Maximum rate')
        number(e['delta_rate'], 'Rate add-on')
        if e.get('r_fixed') is not None:
            number(e['r_fixed'], 'Fixed rate')
    if name == 'S2':
        table(e, 'tenor_s', 'ratios', decreasing=True)
        if e.get('rescale_ladder', False):
            raise ValueError('Optional keeper-rescaled S2 is outside P3')
        if e['tenor_s'][0] > pair.min_T_s or e['tenor_s'][-1] < pair.max_T_s:
            raise ValueError('Ladder must cover term range')
    if name == 'S3':
        validate_premium(pair)
    if name == 'NEG':
        validate_neg(e)


def validate_shared(pair, name):
    e = pair.extra
    lam, cap, oracle_cap = solvency_bounds(pair)
    if pair.lam > lam + 1e-15:
        raise ValueError('Shared lambda bound')
    bound = oracle_cap if name == 'S3' else cap
    if pair.cap > bound + 1e-15:
        raise ValueError('Shared cap bound')
    if pair.lam * (1 + e['b_max']) >= 1:
        raise ValueError('Maximum bonus insurability')
    if pair.lam * (1 + e['pi_max']) > 1:
        raise ValueError('Maximum hard penalty insurability')
    if pair.lam > 1 - e['h_floor']:
        raise ValueError('Haircut floor')
    if name == 'B0_eq':
        number(e['L_eq'], 'Equal capacity', 0, pair.cap, True)


def validate_term(e):
    floor = number(e['sigma_floor'], 'Sigma floor', 0, 5, True) ** 2
    number(e['theta'], 'Theta', floor, 25)
    number(e['v_max'], 'Variance maximum', e['theta'], 25)
    number(e['kappa'], 'Kappa', 0, math.inf, True)
    number(e['delta_rate'], 'Rate add-on')
    number(e['r_max'], 'Maximum rate')
    if e.get('r_fixed') is not None:
        number(e['r_fixed'], 'Fixed rate')
    if e.get('v0_staleness_s') is not None:
        number(e['v0_staleness_s'], 'Variance staleness', 0, math.inf, True)


def validate_neg(e):
    number(e['ltv_base'], 'NEG base', 0, 1)
    number(e['ltv_max'], 'NEG max', e['ltv_base'], 1)
    number(e['k_decay'], 'NEG decay')
    number(e['buffer_min'], 'NEG buffer min', 0, 1)
    number(e['buffer_max'], 'NEG buffer max', e['buffer_min'], 1)
    number(e['k_buffer'], 'NEG buffer decay')


def parameters(pair, code):
    e = pair.extra
    p = np.zeros(56, dtype=np.float64)
    p[:24] = [code, pair.lam, pair.cap, e['sigma'], e['z'],
              e.get('theta', e['sigma'] ** 2), e.get('kappa', 1),
              e.get('sigma_floor', e['sigma']) ** 2, e.get('v_max', 25),
              -1 if e.get('r_fixed') is None else e['r_fixed'],
              e.get('r_max', 0), e.get('delta_rate', 0), e.get('L_eq', pair.cap),
              e.get('ltv_base', .75), e.get('ltv_max', .9), e.get('k_decay', .000007614),
              e.get('buffer_min', .05), e.get('buffer_max', .25), e.get('k_buffer', .000007614),
              pair.min_T_s, pair.max_T_s, e.get('s_min', 0),
              e.get('premium_floor_s', 86400), e.get('rescale_ladder', False)]
    for start, key in [(24, 'tenor_s'), (32, 'ratios'), (40, 'premium_ltv'), (48, 'EL_rate_perp')]:
        if key in e:
            p[start:start + 8] = e[key]
    return p


def validate_premium(pair):
    e = pair.extra
    table(e, 'premium_ltv', 'EL_rate_perp')
    number(e['s_min'], 's_min')
    number(e['premium_floor_s'], 'Premium floor', 0, math.inf, True)
    if e['premium_ltv'][0] > 0 or e['premium_ltv'][-1] < pair.cap:
        raise ValueError('Premium table must cover [0, cap]')
