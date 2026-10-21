"""NEG preserves deployed time-dependent LT and the final-hour HF revert.

It deliberately violates the corrected candidates' cap/LT safety invariant.
Integer LTV and buffer routines directly reuse the bit-exact P2 MathLib port.
"""
from .base import BaseModel
from .kernels import open_limit_nb, threshold_nb
from chrono_sim.protocol.ref.prbmath import compute_ltv, compute_buffer


class NEG(BaseModel):
    name = 'NEG'
    code = 7
    time_free = False
    snapshot_lt = False
