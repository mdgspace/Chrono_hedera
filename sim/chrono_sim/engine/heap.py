"""Versioned liquidation-price max-heaps, one independent heap per pair."""
import heapq
import math
from numba import njit


class LiquidationHeap:
    def __init__(self):
        self.heaps, self.live, self.revisions = {}, {}, {}

    def update(self, pair, position, price):
        if not math.isfinite(price) or price < 0:
            raise ValueError('finite nonnegative liquidation price required')
        key = pair, position
        revision = self.revisions.get(key, 0)+1
        self.revisions[key] = revision
        self.live[key] = revision, price
        heap = self.heaps.setdefault(pair, [])
        heapq.heappush(heap, (-price, position, revision))
        if len(heap) > max(64, 3*sum(k[0] == pair for k in self.live)):
            self.heaps[pair] = [(-p, i, r) for (pkey, i), (r, p) in self.live.items() if pkey == pair]
            heapq.heapify(self.heaps[pair])

    def discard(self, pair, position):
        self.live.pop((pair, position), None)

    def top(self, pair):
        heap = self.heaps.get(pair, [])
        while heap:
            negative, position, revision = heap[0]
            if self.live.get((pair, position)) == (revision, -negative):
                return -negative, position
            heapq.heappop(heap)
        return None


@njit(cache=True)
def next_crossing(t, lows, first, last, log_barrier, growth_per_s, now):
    """Conservative debt-growth bound permits scanning safe bars in native code."""
    for k in range(first, last):
        if lows[k] <= log_barrier+growth_per_s*max(0.0, t[k]-now):
            return k
    return last
