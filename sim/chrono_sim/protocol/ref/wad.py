"""Solidity 0.8 checked uint256 operations and MathLib round-half-up WAD."""
WAD = 10**18
MAX = 2**256 - 1
YEAR = 31_536_000


class Revert(Exception):
    """EVM revert signature and optional panic code, independent of addresses."""
    def __init__(self, signature, code=None):
        super().__init__(signature)
        self.signature = signature
        self.code = code


def uint(value):
    if not 0 <= value <= MAX:
        raise Revert('Panic(uint256)', 0x11)
    return value


def add(a, b):
    return uint(a + b)


def sub(a, b):
    return uint(a - b)


def mul(a, b):
    return uint(a * b)


def div(a, b):
    if b == 0:
        raise Revert('Panic(uint256)', 0x12)
    return a // b


def wad_mul(a, b):
    if a == 0 or b == 0:
        return 0
    return div(add(mul(a, b), WAD // 2), WAD)


def wad_div(a, b):
    if b == 0:
        raise Revert('Error(string)')
    return div(add(mul(a, WAD), b // 2), b)
