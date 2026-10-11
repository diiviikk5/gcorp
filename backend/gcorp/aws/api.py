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


_MODEL_CHECK: dict = {}


def _model_check() -> dict:
    """One tiny Converse call (cached 10 min) — the only honest test of model access."""
    import time
    if _MODEL_CHECK and time.time() - _MODEL_CHECK["at"] < 600:
        return _MODEL_CHECK["v"]
    from ..council.bedrock import MODEL
    from .cloud import client
    try:
        client("bedrock-runtime").converse(modelId=MODEL, messages=[{"role": "user", "content": [{"text": "ok"}]}], inferenceConfig={"maxTokens": 2})
        v = {"ok": True, "model": MODEL, "reason": "ready"}
    except Exception as e:
        m = str(e)
        reason = ("Submit the model provider use-case form in the Bedrock console (one time)" if "use case" in m.lower()
                  else "Account quota for this model is zero for now (new account)" if "Throttling" in type(e).__name__ or "Too many" in m
                  else "Pending AWS account verification" if "verified" in m
                  else "Model not available on this account plan" if "not available" in m
                  else f"{type(e).__name__}")
        v = {"ok": False, "model": MODEL, "reason": reason}
    _MODEL_CHECK.update(at=time.time(), v=v)
    return v


@router.get("")
def status() -> dict:
    st = state()
    if not enabled():
        return {"enabled": False}
    model = _model_check()
    verified = model["ok"]
    svc = lambda name, ok, detail, kind: {"name": name, "ok": bool(ok), "detail": detail, "kind": kind}
    return {
        "enabled": True, "account": st["account"], "region": st["region"], "bedrockReady": verified, "model": model, "dashboard": st.get("dashboard"),
        "services": [
            svc("AgentCore Gateway", st.get("gateway"), "Council tools as MCP · IAM auth per agent", "agentcore"),
            svc("AgentCore Policy", st.get("policyEngine"), f"{(st.get('policyEngine') or {}).get('policies', 0)} Cedar role contracts · ENFORCE", "agentcore"),
            svc("AgentCore Runtime", (st.get("runtime") or {}).get("status") == "READY", "Whole engine as a hosted agent", "agentcore"),
            svc("Bedrock Guardrails", st.get("guardrail"), "Contextual grounding on accepted claims", "bedrock"),
            svc("Bedrock Knowledge Base", st.get("kb"), "Ledger + role contracts on S3 Vectors", "bedrock"),
            svc("Amazon Nova on Bedrock", verified, "Council backend, still gated by the verifier" if verified else model["reason"], "bedrock"),
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
    """The brief as something a ward officer can listen to: figures read out, ids dropped."""
    import re
    from ..tokens import TOKEN
    from .cloud import _resolver
    r = _resolver(run)

    def say(text: str) -> str:
        def one(m):
            v = r.value(m.group(1))
            return "" if re.fullmatch(r"L-[\w-]+\??", v) else v
        return re.sub(r"\s+([,.;])", r"\1", re.sub(r"\s{2,}", " ", TOKEN.sub(one, text))).strip()

    s = run.sims[max(run.sims)]["summary"]
    acc = [c for c in run.claims.values() if c["status"] == "accepted"][:4]
    conf = run.to_json(grids=False)["confidence"]
    title = re.sub(r"(\d+) mo\b", r"\1 months", run.current.title).replace(" · ", ", ")
    parts = [f"{title}.",
             f"Under these assumptions, the estimated reduction is {s['deltaLo']:.0f} to {s['deltaHi']:.0f} AQI points. This is not a forecast.",
             f"Confidence is {conf['grade'].lower()}" + (", because " + "; ".join(conf["reasons"][:2]) + "." if conf["reasons"] else ".")]
    parts += [say(c["text"]) for c in acc]
    return " ".join(parts).replace("–", " to ").replace("%", " percent").replace("PM2.5", "PM 2.5")


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
