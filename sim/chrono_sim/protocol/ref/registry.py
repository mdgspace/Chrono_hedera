"""AssetRegistry defaults at the frozen Solidity revision."""
from .wad import WAD, Revert

DEFAULTS = dict(ltvBase=75*10**16, ltvMax=90*10**16, kDecay=7_614_000_000_000,
                liquidationBonus=5*10**16, closeFactor=WAD//2,
                ltBufferMin=5*10**16, ltBufferMax=25*10**16, kLtBuffer=7_614_000_000_000,
                hardLiqPenalty=12*10**16, hardLiqCollateralFloor=25*10**15,
                stabilityPoolPenaltyShare=75*10**16, reservePenaltyShare=25*10**16,
                minBorrowDuration=3600, maxBorrowDuration=30*86400)


def configs(scenario):
    result = {}
    for token, item in scenario['tokens'].items():
        cfg = {key: int(scenario.get('config', {}).get(token, {}).get(key, 0)) or value
               for key, value in DEFAULTS.items()}
        if cfg['maxBorrowDuration'] > 60*86400:
            raise Revert('DurationExceedsScheduleLimit(uint256,uint256)')
        cfg.update(tokenAddress=token, decimals=item['decimals'],
                   isStablecoin=item.get('stable', False), isActive=True)
        result[token] = cfg
    return result
