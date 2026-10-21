"""Nested exact conditional refinement of minimum-conditioned Brownian bridges.

Level 1 refines a coarse segment to heartbeat nodes, level 2 a heartbeat piece to integer
seconds (P3C_METHOD.md section 3). All values are in role space `z`; the auxiliary argmin
node is inserted for the Bessel(3) construction and dropped from the output.
"""
import math
import numpy as np
from numba import njit
from .intrabar import _minimum_time, _segments
from .keyed import stream, uniform, normal, normals

LEVEL_SEGMENT, LEVEL_PIECE = 1, 2


@njit
def lattice(t0, t1, step):
    """Endpoints plus the multiples of step strictly inside (t0, t1)."""
    first, last = math.floor(t0/step)+1, math.ceil(t1/step)-1
    inner = np.arange(first, last+1)*step if last >= first else np.empty(0)
    out = np.empty(len(inner)+2)
    out[0], out[-1] = t0, t1
    out[1:-1] = inner
    return out


@njit
def truncated_min(y0, y1, floor, variance, u):
    """Bridge minimum conditioned to exceed floor (inverse CDF on (F(floor), 1))."""
    top = min(y0, y1)
    if floor >= top:
        return top
    f = math.exp(-2.*(y0-floor)*(y1-floor)/variance)
    v = f+(1.-f)*u
    return (y0+y1-math.sqrt((y1-y0)**2-2.*variance*math.log(v)))/2.


@njit
def bessel_nodes(nodes, z0, z1, low, tau, sigma, st):
    """Exact values at nodes given endpoints, minimum and its time; tau is relative."""
    rel = nodes-nodes[0]
    k = np.searchsorted(rel, tau)
    exact = k < len(rel) and rel[k] == tau
    t = rel if exact else np.concatenate((rel[:k], np.array([tau]), rel[k:]))
    values = _segments(t, tau, z0, z1, low, sigma, normals(st, len(t)-1, 3))
    if exact:
        return values
    return np.concatenate((values[:k], values[k+1:]))


@njit
def linear(nodes, z0, z1):
    duration = nodes[-1]-nodes[0]
    return z0+(z1-z0)*(nodes-nodes[0])/duration


@njit
def refine_segment(key, a, g, t0, t1, z0, z1, zmin, sigma, step):
    """Heartbeat nodes, node values, piece minima, absolute argmin and its piece (-1 if a node)."""
    nodes = lattice(t0, t1, step)
    pieces = len(nodes)-1
    piece_min = np.empty(pieces)
    if sigma == 0:
        values = linear(nodes, z0, z1)
        for i in range(pieces):
            piece_min[i] = min(values[i], values[i+1])
        return nodes, values, piece_min, t0 if z0 <= z1 else t1, -1
    st = stream(key, a, g, LEVEL_SEGMENT, 0)
    duration = t1-t0
    tau = _minimum_time(z0-zmin, z1-zmin, sigma, duration, normal(st), uniform(st), uniform(st))
    values = bessel_nodes(nodes, z0, z1, zmin, tau, sigma, st)
    owner = -1
    for i in range(pieces):
        if nodes[i]-t0 < tau < nodes[i+1]-t0:
            piece_min[i], owner = zmin, i
        else:
            variance = sigma*sigma*(nodes[i+1]-nodes[i])
            piece_min[i] = truncated_min(values[i], values[i+1], zmin, variance, uniform(st))
    return nodes, values, piece_min, t0+tau, owner


@njit
def refine_piece(key, a, g, i, v0, v1, y0, y1, low, tau_abs, sigma):
    """Integer-second nodes and values of one heartbeat piece; tau_abs < 0 if not the argmin piece."""
    nodes = lattice(v0, v1, 1.)
    if sigma == 0:
        return nodes, linear(nodes, y0, y1)
    st = stream(key, a, g, LEVEL_PIECE, i)
    duration = v1-v0
    if tau_abs >= 0:
        tau = tau_abs-v0
    else:
        tau = _minimum_time(y0-low, y1-low, sigma, duration, normal(st), uniform(st), uniform(st))
    return nodes, bessel_nodes(nodes, y0, y1, low, tau, sigma, st)
