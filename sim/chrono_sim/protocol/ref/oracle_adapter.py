"""PythOracleAdapter mid-price scaling, freshness and MockPyth update rules."""
from .wad import Revert, add, mul, uint


def set_prices(engine, step):
    values = step.get('prices', {step.get('token', 'coll'): step.get('price', '200000000')})
    for token, price in values.items():
        old = engine.prices[token]
        publish = engine.base + int(step.get('publishTime', engine.now - engine.base))
        if engine.oracle == 'mock' or publish > old['publishTime']:
            engine.prices[token] = dict(price=int(price), conf=int(step.get('conf', 0)),
                                        expo=int(step.get('expo', -8)), publishTime=publish)


def power10(exponent):
    if exponent > 77:
        raise Revert('Panic(uint256)', 0x11)
    return 10**exponent


def price(engine, token):
    p = engine.prices[token]
    if engine.oracle == 'mock':
        return p['price']
    if add(p['publishTime'], 120) < engine.now:
        raise Revert('StalePrice(address,uint256,uint256)')
    if p['price'] < 0:
        raise Revert('NegativePrice(address,int64)')
    expo = p['expo']
    if expo == -(2**31):
        raise Revert('Panic(uint256)', 0x11)
    if expo < -18:
        return p['price'] // power10(-expo-18)
    return mul(p['price'], power10(18+expo))
