export function pairConfig(overrides: Record<string, unknown> = {}) {
    return {
        ltvBase: 0, ltvMax: 0, kDecay: 0,
        ltBase: 0, ltMax: 0, kLtDecay: 0,
        liquidationBonus: 0, closeFactor: 0,
        hardLiqPenalty: 0, hardLiqCollateralFloor: 0,
        stabilityPoolPenaltyShare: 0, reservePenaltyShare: 0,
        minBorrowDuration: 0, maxBorrowDuration: 0,
        isActive: true, auctionPhase1Duration: 0, auctionPhase2Duration: 0,
        ...overrides
    };
}
