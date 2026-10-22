import json
import glob
from pathlib import Path

def inspect():
    for f in sorted(glob.glob("sim/results/eth/reference/*/main-*.jsonl")):
        cell = Path(f).parent.name
        print(f"=== Cell: {cell} ===")
        for line in open(f):
            data = json.loads(line)
            if "path" in data:
                p = data["path"]
                dt = data["debt_time"]
                loss = data["loss"]
                cost = data["cost"]
                pr = data["principal"]
                s_sp = data["soft_sp"]
                h_sp = data["hard_sp"]
                nodes = data["nodes"]
                loss_nodes = data["loss_by_term"]
                print(f"  Path {p}: debt_time={dt:.1f}, loss={loss}, cost={cost:.2f}, principal={pr:.2f}, soft_sp={s_sp}, hard_sp={h_sp}")
                print(f"    nodes (liquidated/total): {nodes}")
                print(f"    loss_by_term: {loss_nodes}")

if __name__ == "__main__":
    inspect()
