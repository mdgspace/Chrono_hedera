export const DEFAULT_PAIR_RISK = {
  ltvBase: 0.75,
  ltvMax: 0.90,
  kDecay: 7_614_000_000_000 / 1e18,
  ltBase: 0.80,
  ltMax: 0.92,
  kLtDecay: 7_614_000_000_000 / 1e18,
  minBorrowDuration: 3600,
  maxBorrowDuration: 30 * 86400
}

export function boundedDecayPercent(high, low, kPerSecond, minutes, minSeconds, maxSeconds) {
  const duration = minutes * 60
  if (duration <= minSeconds) return high * 100
  if (duration >= maxSeconds) return low * 100
  const end = Math.exp(-kPerSecond * (maxSeconds - minSeconds))
  if (end === 1) {
    return 100 * (high - (high - low) * (duration - minSeconds) / (maxSeconds - minSeconds))
  }
  const current = Math.exp(-kPerSecond * (duration - minSeconds))
  return 100 * (low + (high - low) * (current - end) / (1 - end))
}
