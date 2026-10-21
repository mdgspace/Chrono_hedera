"""Independent M0 gates and the float RiskModel to integer-ledger boundary."""
from dataclasses import dataclass
from copy import deepcopy
import math
from .wad import WAD, Revert

AS_CODED = '8c414687ff9bfbb6f2e0ce5bd08ed48efa37309f'


@dataclass(frozen=True)
class Switches:
    fix_final_hour: bool = False
    fix_debt_accounting: bool = False
    fix_decimals: bool = False
    pair_config: bool = False
    hard_liq_zero_collateral: bool = False
    conf_prices: bool = False

    @classmethod
    def m0(cls):
        return cls(**dict.fromkeys(cls.__dataclass_fields__, True))


def wad(value):
    return int(round(float(value) * WAD))


def pair(e, coll, debt):
    try:
        return e.pair_risks[(coll, debt)]
    except KeyError as exc:
        raise ValueError(f'pair_config requires PairRisk for {coll}/{debt}') from exc


def market(e, coll=None, debt=None):
    from . import oracle_adapter
    from chrono_sim.models.base import MarketState
    tokens = (coll, debt) if coll is not None else tuple(e.config)
    return MarketState(t_s=float(e.now), price={t: oracle_adapter.price(e, t)/WAD for t in tokens},
                           conf={t: confidence(e, t)/WAD for t in tokens},
                           v0=e.v0, breaker=e.breaker, borrow_apy=0.0)


def view(e, pos):
    c, d = pos['collateralToken'], pos['debtToken']
    from chrono_sim.models.base import PositionView
    ledger = e.interest[str(pos['id'])]
    return PositionView(coll=c, debt=d, coll_amount=pos['collateralAmount']/10**e.config[c]['decimals'],
                           principal=ledger['principal']/10**e.config[d]['decimals'],
                           accrued=ledger['accruedInterest']/10**e.config[d]['decimals'],
                           start_s=float(pos['startTime']), T_s=float(pos['duration']),
                           snap=deepcopy(e.model_snapshots.get(str(pos['id']), {})))


def confidence(e, token):
    p = e.prices[token]
    exponent = p['expo'] + 18
    return p['conf'] * 10**exponent if exponent >= 0 else p['conf']//10**(-exponent)


def prices(e, coll, debt, opening=False):
    from .oracle_adapter import price
    pc, pd = price(e, coll), price(e, debt)
    if not e.switches.conf_prices:
        return pc, pd
    cc, cd = confidence(e, coll), confidence(e, debt)
    if opening and (cc*WAD > e.max_open_conf_ratio*pc or cd*WAD > e.max_open_conf_ratio*pd):
        raise Revert('ConfidenceTooWide(address,uint256,uint256)')
    return max(0, pc-cc*e.conf_multiplier//WAD), pd+cd*e.conf_multiplier//WAD


def value(e, token, amount, price):
    from .wad import wad_mul
    return amount*price//10**e.config[token]['decimals'] if e.switches.fix_decimals else wad_mul(amount, price)


def collateral_for(e, coll, debt, amount, pc, pd, multiplier=WAD):
    from .wad import wad_mul, wad_div
    if not e.switches.fix_decimals:
        return wad_div(wad_mul(wad_mul(amount, pd), multiplier), pc)
    if pc == 0:
        raise Revert('Error(string)')
    return amount*pd*multiplier*10**e.config[coll]['decimals']//(pc*WAD*10**e.config[debt]['decimals'])


def opening_limit(e, coll, debt, duration):
    cfg = pair(e, coll, debt)
    e.risk_model.validate(cfg)
    if not cfg.min_T_s <= duration <= cfg.max_T_s:
        raise Revert('InvalidDuration(uint256,uint256,uint256)')
    mkt = market(e, coll, debt)
    from .interest import apy
    from dataclasses import replace
    mkt = replace(mkt, borrow_apy=apy(e, debt)/WAD)
    if not e.risk_model.originations_allowed(cfg, mkt):
        raise Revert('OriginationsDisabled()')
    if hasattr(e.risk_model, "open_limit_wad"):
        return e.risk_model.open_limit_wad(cfg, duration, mkt)
    return wad(e.risk_model.open_limit(cfg, duration, mkt))


def debt_after_accrual(e, identifier, pos, delta):
    ledger = e.interest[identifier]
    if e.switches.fix_debt_accounting:
        return ledger['principal'], ledger['accruedInterest']
    return pos['borrowAmount'], delta


def threshold(e, pos):
    if e.switches.pair_config and e.risk_model is not None:
        if hasattr(e.risk_model, "threshold_wad"):
            return e.risk_model.threshold_wad(view(e, pos), e.now, market(e, pos['collateralToken'], pos['debtToken']))
        return wad(e.risk_model.threshold(view(e, pos), e.now, market(e, pos['collateralToken'], pos['debtToken'])))
    return e.final_hour_threshold


def soft_terms(e, pos, hf, total):
    if not e.switches.pair_config:
        from .wad import wad_mul
        return e.config[pos['collateralToken']]['liquidationBonus'], wad_mul(total, e.config[pos['debtToken']]['closeFactor'])
    v = view(e, pos)
    unit = 10**e.config[pos['debtToken']]['decimals']
    from .wad import wad_mul
    fraction = e.risk_model.close_amount(v, hf/WAD, total/unit)/(total/unit) if total else 0.
    return wad(e.risk_model.bonus(v, hf/WAD)), wad_mul(total, wad(fraction))


def hard_terms(e, pos, dv, cv):
    if not e.switches.pair_config:
        cfg = e.config[pos['debtToken']]
        from .wad import wad_mul
        return max(wad_mul(dv, cfg['hardLiqPenalty']), wad_mul(cv, cfg['hardLiqCollateralFloor'])), cfg['stabilityPoolPenaltyShare']
    cfg = pair(e, pos['collateralToken'], pos['debtToken'])
    # Values have raw-token scale unless decimals correction is independently on.
    scale = WAD if e.switches.fix_decimals else 10**e.config[pos['debtToken']]['decimals']
    penalty = e.risk_model.hard_penalty(view(e, pos), cv/scale, dv/scale)
    share = view(e, pos).snap.get('sp_share', cfg.sp_share) if getattr(e.risk_model, 'snapshot_lt', True) else e.risk_model.pair_for(view(e, pos)).sp_share
    return int(round(penalty*scale)), wad(share)


def opened(e, identifier, coll, debt, duration, ltv, actor):
    from . import lending_pool as lp, stability_pool as sp
    from .wad import wad_mul, wad_div
    cfg, mkt = pair(e, coll, debt), market(e, coll, debt)
    snap = e.risk_model.snapshot(cfg, duration, mkt)
    e.model_snapshots[identifier] = deepcopy(snap)
    premium = e.risk_model.open_premium(cfg, ltv/WAD, duration, mkt)
    amount = int(round(e.positions[identifier]['borrowAmount']*premium))
    share = wad_mul(amount, wad(cfg.sp_share))
    lp.transfer(e, debt, actor, 'sp', share)
    lp.transfer(e, debt, actor, 'owner', amount-share)
    pool = e.sp[debt]
    if pool['totalScaled'] and share:
        total = wad_mul(pool['totalScaled'], pool['scale'])
        pool['scale'] = wad_div(total+share, pool['totalScaled'])
    e.open_premiums[identifier] = amount, share
