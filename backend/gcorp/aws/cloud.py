"""The engine's bridge to AWS once `gcorp aws up` has run.

Every function degrades to a clear "unavailable" answer instead of raising, so the
local engine keeps working offline and while Bedrock is still being enabled.
"""

from __future__ import annotations

import json
import re
import time
from decimal import Decimal
from functools import lru_cache

from . import ACTING_AGENTS, PREFIX, session, state
from ..tokens import Resolver


def _ok(**kw) -> dict:
    return {"ok": True, **kw}


def _err(e: Exception | str) -> dict:
    msg = str(e)
    if "being verified" in msg:
        msg = "Bedrock access is pending AWS account verification"
    return {"ok": False, "error": msg if isinstance(e, str) else f"{type(e).__name__}: {msg}"[:300]}


@lru_cache(maxsize=None)
def client(name: str):
    return session().client(name)


# --------------------------------------------------------------------------- archive (S3 + DynamoDB + CloudWatch)

def archive(run, out: dict | None = None) -> dict:
    """Run artifacts to S3, a summary row to DynamoDB, council metrics to CloudWatch."""
    from ..orchestrator import _brief, confidence
    st = state()
    sim = run.sims[max(run.sims)]["summary"]
    conf = confidence(run)
    claims = list(run.claims.values())
    n = {k: sum(c["status"] == k for c in claims) for k in ("accepted", "rejected", "ask")}
    key = f"runs/{run.id}/"
    s3 = client("s3")
    s3.put_object(Bucket=st["bucket"], Key=key + "run.json", ContentType="application/json",
                  Body=json.dumps(out or run.to_json(grids=False), ensure_ascii=False).encode())
    s3.put_object(Bucket=st["bucket"], Key=key + "brief.md", ContentType="text/markdown", Body=_brief(run).encode())
    item = {"id": run.id, "createdAt": run.created_at, "title": run.current.title, "policy": run.scenario.text,
            "zone": run.current.zone_id, "deltaLo": sim["deltaLo"], "deltaHi": sim["deltaHi"], "zoneBefore": sim["zoneBefore"],
            "grade": conf["grade"], "score": conf["score"], **n, "s3": f"s3://{st['bucket']}/{key}"}
    client("dynamodb")  # warm
    session().resource("dynamodb").Table(st["tables"]["runs"]).put_item(Item=json.loads(json.dumps(item), parse_float=Decimal))
    client("cloudwatch").put_metric_data(Namespace="Gcorp", MetricData=[
        {"MetricName": "Runs", "Value": 1, "Unit": "Count"},
        {"MetricName": "ClaimsAccepted", "Value": n["accepted"], "Unit": "Count"},
        {"MetricName": "ClaimsRejected", "Value": n["rejected"], "Unit": "Count"},
        {"MetricName": "OpenQuestions", "Value": n["ask"], "Unit": "Count"},
        {"MetricName": "Confidence", "Value": conf["score"], "Unit": "None"},
    ])
    return _ok(s3=item["s3"])


# --------------------------------------------------------------------------- Bedrock Guardrails grounding

def _resolver(run) -> Resolver:
    from .. import ledger
    r = Resolver(run.to_json(grids=False), {x["id"]: x for x in ledger.all_rows()})
    r.round = max(run.sims)
    return r


def ground_claim(run, claim: dict) -> dict:
    """Second opinion on an accepted claim: Bedrock Guardrails contextual grounding.

    Our verifier checks that every figure has a source. The guardrail checks something
    we can't: whether the sentence actually says what the cited sources say.
    """
    from .. import ledger
    st = state().get("guardrail")
    if not st:
        return _err("guardrail not provisioned")
    r = _resolver(run)
    refs = re.findall(r"\[\[(L-[^\]]+)\]\]", claim["text"])
    source = []
    for ref in refs:
        row = ledger.get(ref)
        if row:
            source.append(f"{row['label']}: {r.value(ref)}. Source: {row.get('source', '')}. {row.get('note', '')}")
    s = run.sims[max(run.sims)]["summary"]
    source.append(f"Simulator: estimated reduction {s['deltaLo']:.0f} to {s['deltaHi']:.0f} AQI points; zone mean {s['zoneBefore']:.0f}; "
                  f"ceiling at full compliance {s.get('ceilingPct', 0):.1f}%; regional share {s.get('regionalPct', 0):.0f}%.")
    try:
        res = client("bedrock-runtime").apply_guardrail(
            guardrailIdentifier=st["id"], guardrailVersion=st["version"], source="OUTPUT",
            content=[{"text": {"text": "\n".join(source), "qualifiers": ["grounding_source"]}},
                     {"text": {"text": run.scenario.text, "qualifiers": ["query"]}},
                     {"text": {"text": r.plain(claim["text"]), "qualifiers": ["guard_content"]}}])
    except Exception as e:
        return _err(e)
    scores = {}
    for a in res.get("assessments", []):
        for f in (a.get("contextualGroundingPolicy") or {}).get("filters", []):
            scores[f["type"].lower()] = {"score": round(f["score"], 2), "threshold": f["threshold"], "action": f["action"]}
    return _ok(action=res.get("action"), scores=scores)


# --------------------------------------------------------------------------- Knowledge Base (S3 Vectors)

def kb_search(query: str, k: int = 5) -> dict:
    kb = state().get("kb", {}).get("id")
    if not kb:
        return _err("knowledge base not provisioned")
    try:
        res = client("bedrock-agent-runtime").retrieve(
            knowledgeBaseId=kb, retrievalQuery={"text": query},
            retrievalConfiguration={"vectorSearchConfiguration": {"numberOfResults": k}})
    except Exception as e:
        return _err(e)
    hits = []
    for x in res.get("retrievalResults", []):
        uri = (x.get("location", {}).get("s3Location") or {}).get("uri", "")
        hits.append({"score": round(x.get("score", 0), 3), "text": x["content"]["text"][:400],
                     "rowId": uri.rsplit("/", 1)[-1].removesuffix(".md") if "/ledger/" in uri else None, "uri": uri})
    return _ok(hits=hits)


# --------------------------------------------------------------------------- Polly

VOICES = {"en": ("Kajal", "en-IN"), "hi": ("Kajal", "hi-IN")}


def speak(run_id: str, text: str, lang: str = "en") -> dict:
    """Spoken brief for ward officers. Cached in S3 by run + language."""
    st = state()
    key = f"runs/{run_id}/brief.{lang}.mp3"
    s3 = client("s3")
    try:
        return _ok(audio=s3.get_object(Bucket=st["bucket"], Key=key)["Body"].read(), cached=True)
    except Exception:
        pass
    voice, code = VOICES.get(lang, VOICES["en"])
    try:
        r = client("polly").synthesize_speech(Text=text[:2900], VoiceId=voice, LanguageCode=code, Engine="neural", OutputFormat="mp3")
        audio = r["AudioStream"].read()
    except Exception as e:
        return _err(e)
    s3.put_object(Bucket=st["bucket"], Key=key, Body=audio, ContentType="audio/mpeg")
    return _ok(audio=audio, cached=False)


# --------------------------------------------------------------------------- live readings + alerts

def readings() -> dict:
    st = state()
    t = session().resource("dynamodb").Table(st["tables"]["readings"])
    from boto3.dynamodb.conditions import Key
    out = []
    try:
        from .handlers.ingest import ZONES
        for z in ZONES:
            items = t.query(KeyConditionExpression=Key("zone").eq(z), ScanIndexForward=False, Limit=1)["Items"]
            if items:
                out.append(json.loads(json.dumps(items[0], default=float)))
    except Exception as e:
        return _err(e)
    return _ok(readings=out, updatedAt=max((r["ts"] for r in out), default=None))


def alerts(limit: int = 20) -> dict:
    st = state()
    try:
        items = session().resource("dynamodb").Table(st["tables"]["alerts"]).scan(Limit=200)["Items"]
    except Exception as e:
        return _err(e)
    items = sorted((json.loads(json.dumps(i, default=float)) for i in items), key=lambda i: i.get("ts", ""), reverse=True)
    return _ok(alerts=items[:limit])


def run_watch(policy: str | None = None) -> dict:
    """Start the Step Functions watch loop now instead of waiting for the hourly tick."""
    from .provision import WATCH_POLICY
    sm = state().get("stateMachine")
    if not sm:
        return _err("state machine not provisioned")
    try:
        ex = client("stepfunctions").start_execution(stateMachineArn=sm, name=f"manual-{int(time.time())}",
                                                      input=json.dumps({"watch": policy or WATCH_POLICY}))
    except Exception as e:
        return _err(e)
    return _ok(executionArn=ex["executionArn"])


def executions(limit: int = 8) -> dict:
    sm = state().get("stateMachine")
    if not sm:
        return _err("state machine not provisioned")
    try:
        xs = client("stepfunctions").list_executions(stateMachineArn=sm, maxResults=limit)["executions"]
    except Exception as e:
        return _err(e)
    return _ok(executions=[{"name": x["name"], "status": x["status"], "start": x["startDate"].isoformat(),
                            "stop": x["stopDate"].isoformat() if x.get("stopDate") else None} for x in xs])


# --------------------------------------------------------------------------- AgentCore Gateway (as an agent identity)

_creds: dict[str, tuple[float, object]] = {}


def _agent_credentials(agent: str):
    """Each agent assumes its own IAM role, so Cedar policies can tell agents apart."""
    hit = _creds.get(agent)
    if hit and hit[0] > time.time() + 60:
        return hit[1]
    from botocore.credentials import Credentials
    role = state()["agentRoles"][agent]
    c = client("sts").assume_role(RoleArn=role, RoleSessionName=f"{PREFIX}-{agent}", DurationSeconds=3600)["Credentials"]
    creds = Credentials(c["AccessKeyId"], c["SecretAccessKey"], c["SessionToken"])
    _creds[agent] = (c["Expiration"].timestamp(), creds)
    return creds


def call_tool(agent: str, tool: str, args: dict) -> dict:
    """MCP tools/call through the AgentCore Gateway, signed as `agent`.

    Returns {"ok": True, "result": ...} or {"ok": False, "denied": True, ...} when
    AgentCore Policy refuses the call.
    """
    import urllib.error
    import urllib.request
    from botocore.auth import SigV4Auth
    from botocore.awsrequest import AWSRequest
    st = state()
    gw = st.get("gateway")
    if not gw or agent not in ACTING_AGENTS:
        return _err("gateway not provisioned")
    body = json.dumps({"jsonrpc": "2.0", "id": int(time.time() * 1000) % 10**9, "method": "tools/call",
                       "params": {"name": f"{gw['target']}___{tool}", "arguments": args}}).encode()
    req = AWSRequest(method="POST", url=gw["url"], data=body, headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
    SigV4Auth(_agent_credentials(agent), "bedrock-agentcore", st["region"]).add_auth(req)
    try:
        with urllib.request.urlopen(urllib.request.Request(gw["url"], data=body, headers=dict(req.headers), method="POST"), timeout=30) as r:
            raw = r.read().decode()
    except urllib.error.HTTPError as e:
        return {"ok": False, "status": e.code, "error": e.read().decode()[:400], "denied": e.code in (401, 403)}
    except Exception as e:
        return _err(e)
    if raw.startswith("event:") or "\ndata:" in raw or raw.startswith("data:"):
        raw = next((ln[5:].strip() for ln in raw.splitlines() if ln.startswith("data:")), "{}")
    msg = json.loads(raw)
    if "error" in msg:
        err = msg["error"]
        text = json.dumps(err)
        return {"ok": False, "denied": "olicy" in text or "not authorized" in text.lower() or "denied" in text.lower(), "error": err}
    res = msg.get("result", {})
    if res.get("isError"):
        text = " ".join(c.get("text", "") for c in res.get("content", []))
        return {"ok": False, "denied": "olicy" in text or "denied" in text.lower() or "not authorized" in text.lower(), "error": text[:400]}
    content = res.get("content", [])
    payload = content[0].get("text") if content else None
    try:
        payload = json.loads(payload) if payload else res
    except ValueError:
        pass
    return _ok(result=payload)


def list_tools(agent: str = "planner") -> dict:
    import urllib.request
    from botocore.auth import SigV4Auth
    from botocore.awsrequest import AWSRequest
    st = state()
    gw = st.get("gateway")
    if not gw:
        return _err("gateway not provisioned")
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).encode()
    req = AWSRequest(method="POST", url=gw["url"], data=body, headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
    SigV4Auth(_agent_credentials(agent), "bedrock-agentcore", st["region"]).add_auth(req)
    try:
        with urllib.request.urlopen(urllib.request.Request(gw["url"], data=body, headers=dict(req.headers), method="POST"), timeout=30) as r:
            raw = r.read().decode()
    except Exception as e:
        return _err(e)
    if "data:" in raw and not raw.lstrip().startswith("{"):
        raw = next((ln[5:].strip() for ln in raw.splitlines() if ln.startswith("data:")), "{}")
    return _ok(tools=[t["name"] for t in json.loads(raw).get("result", {}).get("tools", [])])


# --------------------------------------------------------------------------- AgentCore Runtime

def invoke_runtime(payload: dict) -> dict:
    rt = state().get("runtime", {}).get("arn")
    if not rt:
        return _err("runtime not provisioned")
    import uuid
    try:
        r = client("bedrock-agentcore").invoke_agent_runtime(
            agentRuntimeArn=rt, runtimeSessionId=f"gcorp-{uuid.uuid4().hex}", contentType="application/json",
            accept="application/json", payload=json.dumps(payload).encode())
        body = r["response"].read()
    except Exception as e:
        return _err(e)
    return _ok(run=json.loads(body))
