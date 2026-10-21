"""Lazy position compounding and simple reserve indices, exactly as coded."""
from .wad import WAD, YEAR, add, sub, mul, div, wad_mul, wad_div
from .prbmath import compound, kink
from .lending_pool import total


def rate(stable, borrowed, deposits):
    u = 0 if deposits == 0 else wad_div(borrowed, deposits)
    if stable:
        return kink(u, 5*10**15, 90*10**16, 4*10**16, 60*10**16)
    return kink(u, 15*10**15, 80*10**16, 6*10**16, WAD)


def apy(e, token):
    return rate(e.config[token]['isStablecoin'], e.lp[token]['borrowed'], total(e, token))


def init(e, identifier, token, principal):
    e.interest[identifier] = dict(debtToken=token, principal=principal,
                                  accruedInterest=0, lastAccrualTime=e.now)


def clear(e, identifier):
    e.interest[identifier] = dict(debtToken=None, principal=0, accruedInterest=0, lastAccrualTime=0)


def accrue(e, identifier):
    pos = e.interest.get(identifier)
    if not pos or pos['debtToken'] is None or e.now <= pos['lastAccrualTime']:
        return 0
    debt = add(pos['principal'], pos['accruedInterest'])
    delta = sub(compound(debt, apy(e, pos['debtToken']), sub(e.now, pos['lastAccrualTime'])), debt)
    pos['accruedInterest'] = add(pos['accruedInterest'], delta)
    pos['lastAccrualTime'] = e.now
    return delta


def update(e, identifier, principal, accrued):
    e.interest[identifier].update(principal=principal, accruedInterest=accrued)


def index(e, token):
    data = e.indices[token]
    if data['borrowIndex'] == 0:
        data.update(borrowIndex=WAD, lastUpdateTimestamp=e.now)
        return
    elapsed = sub(e.now, data['lastUpdateTimestamp'])
    factor = div(mul(apy(e, token), elapsed), YEAR)
    data['borrowIndex'] = add(data['borrowIndex'], wad_mul(data['borrowIndex'], factor))
    data['lastUpdateTimestamp'] = e.now
