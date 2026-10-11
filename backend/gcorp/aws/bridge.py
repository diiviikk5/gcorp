"""Run an assessment on AgentCore Runtime and bring it home.

The runtime returns events, claims and summaries without the per-cell grids (they are
big). The simulator is deterministic, so the engine re-simulates each round locally and
checks that the fingerprints match the cloud's: same inputs, same answer, anywhere.
"""

from __future__ import annotations

import json

from ..compiler import compile_policy
from ..orchestrator import Run
from ..rng import fnv1a
from ..simulator import simulate
from .cloud import invoke_runtime


def run_on_agentcore(text: str, zone: str | None, overrides: dict | None, backend: str = "rules") -> Run:
    r = invoke_runtime({"policy": text, "zone": zone, "overrides": overrides, "backend": backend})
    if not r.get("ok"):
        raise RuntimeError(f"AgentCore Runtime: {r.get('error')}")
    data = r["run"]
    sc = compile_policy(text, zone, overrides)
    sc.id = data["id"]
    run = Run(data["id"], data.get("kind", "assessment"), data["createdAt"], sc)
    run.events, run.claims = data["events"], data["claims"]
    final = data.get("finalOverrides") or {}
    matches = []
    for k, remote in sorted(data["sims"].items(), key=lambda kv: int(kv[0])):
        n = int(k)
        ov = final if n > 1 else {}
        cur = sc.with_changes(ov) if ov else sc
        res = simulate(cur, n).to_json()
        res["fingerprint"] = fnv1a(cur.fingerprint + json.dumps(ov, sort_keys=True)) if n > 1 else fnv1a(sc.fingerprint + json.dumps({}, sort_keys=True))
        matches.append(res["fingerprint"] == remote.get("fingerprint"))
        res["fingerprint"] = remote.get("fingerprint", res["fingerprint"])
        res["ms"] = remote.get("ms")
        run.sims[n] = res
    run.overrides = final
    run.cloud = {**(data.get("cloud") or {}), "host": data.get("host"), "fingerprintsMatch": all(matches)}
    return run
