"""SPEC uses current APY in the capped GBM form and floating LT."""
from .base import BaseModel
from .kernels import open_limit_nb, threshold_nb


class SPEC(BaseModel):
    name = 'SPEC'
    code = 5
    snapshot_lt = False
