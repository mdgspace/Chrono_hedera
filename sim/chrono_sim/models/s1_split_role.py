"""S1: mean-reverting term variance, snapshotted LT, maturity-value opening."""
from .base import BaseModel
from .kernels import open_limit_nb, threshold_nb


class S1(BaseModel):
    name = 'S1'
    code = 0
