"""Indexed max-heaps: one live entry per position and one heap per pair."""
from numba import njit


@njit
def swap(heap, locations, a, b):
    x, y = heap[a], heap[b]
    heap[a], heap[b] = y, x
    locations[x], locations[y] = b, a


@njit
def repair(heap, locations, keys, count, at):
    while at and keys[heap[at]] > keys[heap[(at-1)//2]]:
        swap(heap, locations, at, (at-1)//2)
        at = (at-1)//2
    while at*2+1 < count:
        child = at*2+1
        if child+1 < count and keys[heap[child+1]] > keys[heap[child]]:
            child += 1
        if keys[heap[at]] >= keys[heap[child]]:
            break
        swap(heap, locations, at, child)
        at = child


@njit
def update(heap, locations, keys, count, position, value):
    at = locations[position]
    keys[position] = value
    if value <= 0:
        if at >= 0:
            count -= 1
            heap[at] = heap[count]
            locations[heap[at]] = at
            locations[position] = -1
            if at < count:
                repair(heap, locations, keys, count, at)
    else:
        if at < 0:
            if count == len(heap):
                raise RuntimeError('native liquidation heap capacity exceeded')
            at, count = count, count+1
            heap[at], locations[position] = position, at
        repair(heap, locations, keys, count, at)
    return count
