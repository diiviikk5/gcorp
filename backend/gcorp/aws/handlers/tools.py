"""Lambda behind the AgentCore Gateway: the council's tools as MCP tools.

The gateway calls this with the tool arguments as the event and the tool name in
client_context.custom["bedrockAgentCoreToolName"] ("<target>___<tool>").
Step Functions calls it directly with {"tool": ..., ...}.

By the time a call lands here, AgentCore Policy (Cedar) has already decided whether
the calling agent may use this tool with these arguments. This code does not re-check
role contracts: that is the point of moving them into Cedar.
"""

from __future__ import annotations

import json
import os

os.environ.setdefault("GCORP_RUNS_DIR", "/tmp/runs")

from gcorp import ledger, verifier  # noqa: E402
from gcorp.compiler import compile_policy  # noqa: E402
from gcorp.simulator import simulate  # noqa: E402


def _tool_name(event: dict, context) -> str:
    if event.get("tool"):
        return event["tool"]
    try:
        name = context.client_context.custom["bedrockAgentCoreToolName"]
    except (AttributeError, KeyError, TypeError):
        return ""
    return name.split("___", 1)[-1]


def ledger_lookup(a: dict) -> dict:
    row = ledger.get(a.get("rowId", ""))
    return {"found": bool(row), "row": row}


def ledger_search(a: dict) -> dict:
    q = [w for w in str(a.get("query", "")).lower().split() if len(w) > 2]
    hits = []
    for r in ledger.all_rows():
        hay = f"{r.get('id','')} {r.get('label','')} {r.get('source','')} {r.get('note','')}".lower()
        score = sum(hay.count(w) for w in q)
        if score:
            hits.append((score, r))
    hits.sort(key=lambda x: -x[0])
    return {"rows": [r for _, r in hits[: int(a.get("limit", 5))]]}


def simulate_policy(a: dict) -> dict:
    sc = compile_policy(a["policy"], a.get("zone"), a.get("overrides") or None)
    res = simulate(sc).to_json(with_grids=False)
    return {"scenario": sc.to_json(), "fingerprint": res["fingerprint"], "summary": res["summary"]}


def verify_claim(a: dict) -> dict:
    v = verifier.check(a["text"], a.get("scope", "city"))
    return {"status": v.status, "reason": v.reason, "rule": v.rule, "ledgerRef": v.ledger_ref}


def propose_change(a: dict) -> dict:
    # Reaching this line means Cedar permitted this agent to move this input.
    return {"accepted": True, "key": a["key"], "value": a["value"], "agent": a.get("agent", "")}


def assess(a: dict) -> dict:
    from gcorp.orchestrator import confidence, execute
    run = execute(a["policy"], a.get("zone"))
    s = run.sims[max(run.sims)]["summary"]
    claims = list(run.claims.values())
    return {"id": run.id, "title": run.current.title, "zone": run.current.zone_id,
            "deltaLo": round(s["deltaLo"]), "deltaHi": round(s["deltaHi"]), "pctLo": round(s["pctLo"], 1), "pctHi": round(s["pctHi"], 1),
            "zoneBefore": round(s["zoneBefore"]), "confidence": confidence(run),
            "accepted": sum(c["status"] == "accepted" for c in claims), "rejected": sum(c["status"] == "rejected" for c in claims),
            "asks": sum(c["status"] == "ask" for c in claims)}


TOOLS = {"ledger_lookup": ledger_lookup, "ledger_search": ledger_search, "simulate": simulate_policy,
         "verify_claim": verify_claim, "propose_change": propose_change, "assess": assess}


def handler(event, context):
    name = _tool_name(event or {}, context)
    fn = TOOLS.get(name)
    if not fn:
        return {"error": f"unknown tool {name!r}", "tools": sorted(TOOLS)}
    args = {k: v for k, v in (event or {}).items() if k != "tool"}
    try:
        return fn(args)
    except Exception as e:  # surface as tool output, not a Lambda crash
        return {"error": f"{type(e).__name__}: {e}"}


# Tool schemas registered on the gateway target (MCP inputSchema subset).
SCHEMAS = [
    {"name": "ledger_lookup", "description": "Open one source-ledger row by id (e.g. L-011). Returns its value, unit, source and status.",
     "inputSchema": {"type": "object", "properties": {"rowId": {"type": "string"}}, "required": ["rowId"]}},
    {"name": "ledger_search", "description": "Keyword search over the source ledger.",
     "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}, "limit": {"type": "integer"}}, "required": ["query"]}},
    {"name": "simulate", "description": "Compile a plain-English air policy and run the deterministic simulator. Returns the AQI range and fingerprint.",
     "inputSchema": {"type": "object", "properties": {"policy": {"type": "string"}, "zone": {"type": "string"}, "overrides": {"type": "object"}}, "required": ["policy"]}},
    {"name": "verify_claim", "description": "Run the verifier on a claim written with provenance tokens ([[L-011]], [[sim:deltaRange]]).",
     "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}, "scope": {"type": "string"}}, "required": ["text"]}},
    {"name": "propose_change", "description": "Propose changing one simulator input. Only roles whose contract allows that input are permitted (enforced by AgentCore Policy).",
     "inputSchema": {"type": "object", "properties": {"key": {"type": "string"}, "value": {"type": "string"}, "agent": {"type": "string"}}, "required": ["key", "value"]}},
    {"name": "assess", "description": "Run a full council assessment and return the summary and confidence grade.",
     "inputSchema": {"type": "object", "properties": {"policy": {"type": "string"}, "zone": {"type": "string"}}, "required": ["policy"]}},
]

if __name__ == "__main__":
    print(json.dumps(handler({"tool": "simulate", "policy": "Ban trucks at night in Anand Vihar"}, None)["summary"], indent=1)[:400])
