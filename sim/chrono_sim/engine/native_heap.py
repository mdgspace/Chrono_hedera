"""Fixed-capacity event heap, ordered exactly like the Python queue."""
import numpy as np
from numba import njit


@njit
def earlier(a, b):
    for j in range(3):
        if a[j] != b[j]:
            return a[j] < b[j]
    return False


@njit
def push(heap, count, horizon, at, priority, serial, kind, data, position):
    if at > horizon+1e-9:
        return count
    if count >= len(heap):
        raise RuntimeError('native event heap capacity exceeded')
    row = np.array([at, priority, serial, kind, data, position], dtype=np.float64)
    i = count
    while i and earlier(row, heap[(i-1)//2]):
        heap[i] = heap[(i-1)//2]
        i = (i-1)//2
    heap[i] = row
    return count+1


@njit
def pop(heap, count):
    row = heap[0].copy()
    count -= 1
    if count:
        last, i = heap[count].copy(), 0
        while 2*i+1 < count:
            child = 2*i+1
            if child+1 < count and earlier(heap[child+1], heap[child]):
                child += 1
            if not earlier(heap[child], last):
                break
            heap[i] = heap[child]
            i = child
        heap[i] = last
    return row, count
