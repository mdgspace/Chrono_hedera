"""StabilityPool scaled deposits and per-collateral reward ledgers."""
from .wad import WAD, Revert, add, sub, wad_mul, wad_div
from .lending_pool import transfer


def initial(actors, tokens):
    return dict(scale=0, totalScaled=0, users=dict.fromkeys(actors, 0), absorbed=[],
                cumulative=dict.fromkeys(tokens, 0),
                lastSeen={a: dict.fromkeys(tokens, 0) for a in actors},
                pending={a: dict.fromkeys(tokens, 0) for a in actors})


def rewards(pool, actor):
    for coll in pool['absorbed']:
        cumulative = pool['cumulative'][coll]
        seen = pool['lastSeen'][actor][coll]
        if cumulative > seen:
            reward = wad_mul(pool['users'][actor], sub(cumulative, seen))
            pool['pending'][actor][coll] = add(pool['pending'][actor][coll], reward)
            pool['lastSeen'][actor][coll] = cumulative


def deposit(e, token, actor, amount):
    if amount == 0:
        raise Revert('ZeroAmount()')
    p = e.sp[token]
    p['scale'] = p['scale'] or WAD
    rewards(p, actor)
    scaled = wad_div(amount, p['scale'])
    p['totalScaled'] = add(p['totalScaled'], scaled)
    p['users'][actor] = add(p['users'][actor], scaled)
    transfer(e, token, actor, 'sp', amount)


def withdraw(e, token, actor, amount):
    if amount == 0:
        raise Revert('ZeroAmount()')
    p = e.sp[token]
    p['scale'] = p['scale'] or WAD
    rewards(p, actor)
    scaled = wad_div(amount, p['scale'])
    if scaled > p['users'][actor]:
        scaled = p['users'][actor]
        amount = wad_mul(scaled, p['scale'])
    p['totalScaled'] = sub(p['totalScaled'], scaled)
    p['users'][actor] = sub(p['users'][actor], scaled)
    transfer(e, token, 'sp', actor, amount)


def can_absorb(e, token, amount):
    p = e.sp[token]
    return p['scale'] != 0 and wad_mul(p['totalScaled'], p['scale']) >= amount


def absorb(e, token, amount, coll, collateral):
    if amount == 0 or collateral == 0:
        raise Revert('ZeroAmount()')
    p = e.sp[token]
    p['scale'] = p['scale'] or WAD
    current = wad_mul(p['totalScaled'], p['scale'])
    if current < amount:
        raise Revert('InsufficientBalance(address,uint256,uint256)')
    if coll not in p['absorbed']:
        p['absorbed'].append(coll)
    p['cumulative'][coll] = add(p['cumulative'][coll], wad_div(collateral, p['totalScaled']))
    p['scale'] = wad_div(sub(current, amount), p['totalScaled'])
    transfer(e, token, 'sp', 'liquidation', amount)


def claim(e, token, actor):
    p = e.sp[token]
    rewards(p, actor)
    for coll in p['absorbed']:
        reward = p['pending'][actor][coll]
        if reward:
            p['pending'][actor][coll] = 0
            transfer(e, coll, 'sp', actor, reward)
