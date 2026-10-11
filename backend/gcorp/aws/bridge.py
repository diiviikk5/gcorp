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


def rehydrate(data: dict) -> Run:
    """A run from its JSON (no grids): re-simulate each round locally and check fingerprints."""
    scj = data["scenario"]
    zone = scj.get("zoneId")
    zone = None if zone in (None, "all") else zone
    inputs = data.get("inputOverrides") or None
    sc = compile_policy(scj["text"], zone, inputs)
    sc.id = data["id"]
    run = Run(data["id"], data.get("kind", "assessment"), data["createdAt"], sc)
    run.events, run.claims = data["events"], data["claims"]
    run.observed = data.get("observed")
    run.input_overrides = inputs
    final = data.get("finalOverrides") or {}
    matches = []
    for k, remote in sorted(data["sims"].items(), key=lambda kv: int(kv[0])):
        n = int(k)
        ov = final if n > 1 else {}
        cur = sc.with_changes(ov) if ov else sc
        res = simulate(cur, n).to_json()
        res["fingerprint"] = fnv1a(cur.fingerprint + json.dumps(ov, sort_keys=True))
        matches.append(res["fingerprint"] == remote.get("fingerprint"))
        res["fingerprint"] = remote.get("fingerprint", res["fingerprint"])
        res["ms"] = remote.get("ms")
        run.sims[n] = res
    run.overrides = final
    run.cloud = {**(data.get("cloud") or {}), "host": data.get("host") or (data.get("cloud") or {}).get("host"),
                 "fingerprintsMatch": all(matches)}
    return run


def run_on_agentcore(text: str, zone: str | None, overrides: dict | None, backend: str = "rules") -> Run:
    r = invoke_runtime({"policy": text, "zone": zone, "overrides": overrides, "backend": backend})
    if not r.get("ok"):
        raise RuntimeError(f"AgentCore Runtime: {r.get('error')}")
    data = r["run"]
    data.setdefault("inputOverrides", overrides)
    return rehydrate(data)


def load_archived(run_id: str) -> Run | None:
    """A run another engine instance created: from the S3 archive."""
    from . import state
    from .cloud import client
    try:
        body = client("s3").get_object(Bucket=state()["bucket"], Key=f"runs/{run_id}/run.json")["Body"].read()
    except Exception:
        return None
    return rehydrate(json.loads(body))


def archived_ids(limit: int = 40) -> list[str]:
    from . import session, state
    try:
        items = session().resource("dynamodb").Table(state()["tables"]["runs"]).scan(Limit=200, ProjectionExpression="id, createdAt")["Items"]
    except Exception:
        return []
    return [i["id"] for i in sorted(items, key=lambda i: i.get("createdAt", ""), reverse=True)[:limit]]
