"""LendingPool share ledger, including reserve write-off semantics."""
from .wad import Revert, add, sub, mul, div


def transfer(e, token, source, target, amount):
    if e.balances[token][source] < amount:
        raise Revert('ERC20InsufficientBalance(address,uint256,uint256)')
    e.balances[token][source] = sub(e.balances[token][source], amount)
    e.balances[token][target] = add(e.balances[token][target], amount)


def total(e, token):
    return add(e.balances[token]['lp'], e.lp[token]['borrowed'])


def deposit(e, token, actor, amount, receiver=None):
    if amount == 0:
        raise Revert('ZeroAmount()')
    if not e.config[token]['isActive']:
        raise Revert('AssetNotSupported(address)')
    pool = e.lp[token]
    shares = amount if pool['shares'] == 0 or total(e, token) == 0 else div(mul(amount, pool['shares']), total(e, token))
    if shares == 0:
        raise Revert('ZeroAmount()')
    pool['shares'] = add(pool['shares'], shares)
    receiver = receiver or actor
    pool['users'][receiver] = add(pool['users'][receiver], shares)
    transfer(e, token, actor, 'lp', amount)


def withdraw(e, token, actor, shares):
    pool = e.lp[token]
    if shares == 0:
        raise Revert('ZeroAmount()')
    if pool['users'][actor] < shares:
        raise Revert('InsufficientBalance(address,uint256,uint256)')
    amount = div(mul(shares, total(e, token)), pool['shares'])
    if amount == 0:
        raise Revert('ZeroAmount()')
    if amount > e.balances[token]['lp']:
        raise Revert('InsufficientLiquidity(address,uint256,uint256)')
    pool['shares'] = sub(pool['shares'], shares)
    pool['users'][actor] = sub(pool['users'][actor], shares)
    transfer(e, token, 'lp', actor, amount)


def reserve(e, token, amount):
    if amount == 0:
        raise Revert('ZeroAmount()')
    if amount > e.balances[token]['lp']:
        raise Revert('InsufficientLiquidity(address,uint256,uint256)')
    e.lp[token]['borrowed'] = add(e.lp[token]['borrowed'], amount)
    transfer(e, token, 'lp', 'vault', amount)


def return_liquidity(e, token, amount):
    if amount == 0:
        raise Revert('ZeroAmount()')
    e.lp[token]['borrowed'] = sub(e.lp[token]['borrowed'], amount)
