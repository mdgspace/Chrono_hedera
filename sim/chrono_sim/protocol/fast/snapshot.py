"""P2-shaped snapshots at the Python boundary, outside the numeric hot path."""
from .state import *


def snapshot(e):
    s, tokens, accounts = e.state, e.tokens, e.accounts
    balances, lp, sp, indices, prices = {}, {}, {}, {}, {}
    cfg = {}
    for t, token in enumerate(tokens):
        cfg[token] = {k: s.cfg[t, j] for j, k in enumerate(CONFIG_KEYS)}
        cfg[token].update(tokenAddress=token, decimals=int(s.cfg[t, 14]),
                          isStablecoin=bool(s.cfg[t, 15]), isActive=bool(s.cfg[t, 16]))
        balances[token] = dict(zip(accounts, s.balances[t].tolist()))
        lp[token] = dict(borrowed=s.lp[t, 0], shares=s.lp[t, 1],
                         users=dict(zip(e.actors, s.lp_users[t, :len(e.actors)].tolist())))
        sp[token] = pool_snapshot(e, t)
        indices[token] = dict(borrowIndex=s.indices[t, 0], lastUpdateTimestamp=s.indices[t, 1])
        p = s.prices[t]
        prices[token] = dict(price=p[0], conf=p[1], expo=int(p[2]), publishTime=p[3])
    positions, interest = positions_snapshot(e)
    scheduler = (dict(kind='real_no_capacity', positionSchedules={}) if s.meta[3] else
                 dict(kind='mock', lastPositionId=0, lastExpiryTimestamp=0))
    if len(positions) and not s.meta[3]:
        last = str(int(s.meta[1])-1)
        scheduler.update(lastPositionId=int(last), lastExpiryTimestamp=positions[last]['startTime']+positions[last]['duration'])
    return dict(timestamp=s.meta[0], config=cfg, prices=prices, balances=balances, lp=lp, sp=sp,
                indices=indices, positions=positions, interest=interest,
                nextPositionId=int(s.meta[1]), scheduler=scheduler)


def pool_snapshot(e, t):
    s = e.state
    absorbed = [e.tokens[i] for i in e.absorbed_order[t]]
    rewards = lambda array, a: dict(zip(e.tokens, array[t, a].tolist()))
    return dict(scale=s.sp[t, 0], totalScaled=s.sp[t, 1],
                users=dict(zip(e.actors, s.sp_users[t, :len(e.actors)].tolist())), absorbed=absorbed,
                cumulative=dict(zip(e.tokens, s.cumulative[t].tolist())),
                lastSeen={actor: rewards(s.seen, a) for a, actor in enumerate(e.actors)},
                pending={actor: rewards(s.pending, a) for a, actor in enumerate(e.actors)})


def positions_snapshot(e):
    positions, interest = {}, {}
    for i in range(int(e.state.meta[1])-1):
        p = e.state.positions[i]
        identifier = str(i+1)
        coll, debt = e.tokens[int(p[COLL])], e.tokens[int(p[DEBT])]
        positions[identifier] = dict(id=i+1, borrower=e.accounts[int(p[OWNER])], collateralToken=coll,
                                    debtToken=debt, collateralAmount=p[C], borrowAmount=p[B],
                                    startTime=p[START], duration=p[TERM], active=bool(p[ACTIVE]),
                                    scheduledTxAddress='0x0000000000000000000000000000000000000123')
        interest[identifier] = dict(debtToken=debt if p[IA] else None, principal=p[PRINCIPAL],
                                    accruedInterest=p[ACCRUED], lastAccrualTime=p[LAST])
    return positions, interest
