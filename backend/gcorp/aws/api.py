"""/api/aws/* — what the web app's Cloud page and briefs use."""

from __future__ import annotations


from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from . import enabled, state

router = APIRouter(prefix="/api/aws")
RUNS: dict = {}  # set by gcorp.api


def _need():
    if not enabled():
        raise HTTPException(409, "AWS is not provisioned. Run `gcorp aws up`.")
    from . import cloud
    return cloud


@router.get("")
def status() -> dict:
    st = state()
    if not enabled():
        return {"enabled": False}
    verified = None
    try:  # one tiny call tells us whether Bedrock is open on this account yet
        from .cloud import client
        client("bedrock-runtime").apply_guardrail(guardrailIdentifier=st["guardrail"]["id"], guardrailVersion=st["guardrail"]["version"],
                                                   source="INPUT", content=[{"text": {"text": "ping"}}])
        verified = True
    except Exception as e:
        verified = False if "verified" in str(e) or "Too many requests" in str(e) or "ThrottlingException" in type(e).__name__ else None
    svc = lambda name, ok, detail, kind: {"name": name, "ok": bool(ok), "detail": detail, "kind": kind}
    return {
        "enabled": True, "account": st["account"], "region": st["region"], "bedrockReady": verified, "dashboard": st.get("dashboard"),
        "services": [
            svc("AgentCore Gateway", st.get("gateway"), "Council tools as MCP · IAM auth per agent", "agentcore"),
            svc("AgentCore Policy", st.get("policyEngine"), f"{(st.get('policyEngine') or {}).get('policies', 0)} Cedar role contracts · ENFORCE", "agentcore"),
            svc("AgentCore Runtime", (st.get("runtime") or {}).get("status") == "READY", "Whole engine as a hosted agent", "agentcore"),
            svc("Bedrock Guardrails", st.get("guardrail"), "Contextual grounding on accepted claims", "bedrock"),
            svc("Bedrock Knowledge Base", st.get("kb"), "Ledger + role contracts on S3 Vectors", "bedrock"),
            svc("Claude on Bedrock", verified, "Council backend, still gated by the verifier", "bedrock"),
            svc("Step Functions", st.get("stateMachine"), "Hourly watch loop: ingest → re-assess → alert", "flow"),
            svc("EventBridge Scheduler", st.get("schedule"), "rate(1 hour)", "flow"),
            svc("Lambda", st.get("lambdas"), "gcorp-tools · gcorp-ingest", "flow"),
            svc("DynamoDB", st.get("tables"), "runs · readings · alerts", "data"),
            svc("S3", st.get("bucket"), "Run archive, KB docs, spoken briefs", "data"),
            svc("SNS", st.get("topic"), "Air alerts (6 h cooldown)", "data"),
            svc("SSM Parameter Store", st.get("openaqParam"), "OpenAQ key, SecureString", "data"),
            svc("CloudWatch", st.get("dashboard"), "Dashboard + 8 custom metrics", "data"),
            svc("Polly", st.get("bucket"), "Spoken briefs (en-IN)", "data"),
            svc("IAM", st.get("agentRoles"), f"{len(st.get('agentRoles') or {})} agent identities", "data"),
        ],
    }


@router.get("/readings")
def readings() -> dict:
    return _need().readings()


@router.get("/alerts")
def alerts() -> dict:
    return _need().alerts()


@router.get("/executions")
def executions() -> dict:
    return _need().executions()


@router.post("/watch")
def watch() -> dict:
    return _need().run_watch()


@router.get("/search")
def search(q: str) -> dict:
    return _need().kb_search(q)


@router.get("/tools")
def tools(agent: str = "engineer") -> dict:
    return _need().list_tools(agent)


GATE_CASES = [
    ("externalities", "propose_change", {"key": "regionalPct", "value": "40"}, "Its contract names regionalPct"),
    ("economist", "propose_change", {"key": "regionalPct", "value": "40"}, "Not in the economist's contract"),
    ("skeptic", "propose_change", {"key": "compliancePct", "value": "55"}, "Its contract names compliancePct"),
    ("skeptic", "propose_change", {"key": "regionalPct", "value": "10"}, "Wrong input for this role"),
    ("engineer", "ledger_lookup", {"rowId": "L-011"}, "Every council member may read the ledger"),
    ("engineer", "assess", {"policy": "Ban trucks at night"}, "Only the planner may launch a run"),
]


@router.post("/gate")
def gate() -> dict:
    """The same tool calls, decided by AgentCore Policy for different agents."""
    cloud = _need()
    from concurrent.futures import ThreadPoolExecutor

    def one(case):
        agent, tool, args, why = case
        r = cloud.call_tool(agent, tool, {**args, **({"agent": agent} if tool == "propose_change" else {})})
        return {"agent": agent, "tool": tool, "args": args, "why": why,
                "decision": "permit" if r.get("ok") else "deny" if r.get("denied") else "error",
                "detail": None if r.get("ok") else str(r.get("error"))[:200]}
    with ThreadPoolExecutor(max_workers=6) as ex:
        return {"results": list(ex.map(one, GATE_CASES))}


def _spoken(run) -> str:
    from .cloud import _resolver
    r = _resolver(run)
    s = run.sims[max(run.sims)]["summary"]
    acc = [c for c in run.claims.values() if c["status"] == "accepted"][:4]
    conf = run.to_json(grids=False)["confidence"]
    parts = [f"{run.current.title.replace('·', ',')}.",
             f"Under these assumptions, the estimated reduction is {s['deltaLo']:.0f} to {s['deltaHi']:.0f} AQI points. This is not a forecast.",
             f"Confidence is {conf['grade'].lower()}" + (", because " + "; ".join(conf["reasons"][:2]) + "." if conf["reasons"] else ".")]
    parts += [r.plain(c["text"]) for c in acc]
    return " ".join(parts).replace("–", " to ").replace("%", " percent")


@router.get("/runs/{run_id}/audio")
def audio(run_id: str, lang: str = "en") -> Response:
    cloud = _need()
    run = RUNS.get(run_id)
    if not run:
        raise HTTPException(404, f"No run {run_id}")
    r = cloud.speak(run_id, _spoken(run), lang)
    if not r.get("ok"):
        raise HTTPException(503, r.get("error"))
    return Response(r["audio"], media_type="audio/mpeg", headers={"Cache-Control": "max-age=3600"})


@router.get("/runs/{run_id}/script")
def script(run_id: str) -> dict:
    run = RUNS.get(run_id)
    if not run:
        raise HTTPException(404, f"No run {run_id}")
    return {"text": _spoken(run)}
