"""`gcorp aws up | status | down` — provisions Gcorp's AWS footprint with boto3.

Idempotent: every step looks for what it would create and reuses it. Ids go to
~/.gcorp/aws.json. Steps can run on their own (`gcorp aws up --only kb`).

Cost notes (Free plan credits): no NAT gateways, no OpenSearch, no always-on compute.
Lambda, DynamoDB on-demand, Step Functions, Scheduler, SNS and S3 sit in free tiers at
this scale; custom CloudWatch metrics are capped at eight; Bedrock, Guardrails, Polly
and AgentCore bill per use only.
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import time
import zipfile
from pathlib import Path

from . import ACTING_AGENTS, PREFIX, REGION, save, session, state

PKG = Path(__file__).resolve().parents[1]          # backend/gcorp
BACKEND = PKG.parent                                # backend/
BUILD = BACKEND / ".build"
TAGS = {"project": "gcorp"}
SKIP = {"api.py", "cli.py", "client.py", "__pycache__"}

log = print


def _say(step: str, msg: str) -> None:
    log(f"  {step:<10} {msg}")


def _retry(fn, *a, tries: int = 12, wait: float = 5, on=("InvalidParameterValue", "cannot be assumed", "AccessDenied", "role", "ValidationException"), **kw):
    for i in range(tries):
        try:
            return fn(*a, **kw)
        except Exception as e:  # IAM is eventually consistent
            msg = str(e)
            if i == tries - 1 or not any(o in msg for o in on):
                raise
            time.sleep(wait)


# --------------------------------------------------------------------------- packaging

def _zip_core(extra: dict[str, bytes] | None = None, deps: Path | None = None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in PKG.rglob("*"):
            rel = f.relative_to(PKG.parent)
            if f.is_dir() or any(p in SKIP for p in rel.parts) or f.suffix == ".pyc":
                continue
            if "cache" in rel.parts and f.name.startswith("ward_"):
                continue  # street geometry is web-only
            z.write(f, rel.as_posix())
        if deps and deps.exists():
            for f in deps.rglob("*"):
                if f.is_file() and "__pycache__" not in f.parts:
                    z.write(f, f.relative_to(deps).as_posix())
        for name, data in (extra or {}).items():
            z.writestr(name, data)
    return buf.getvalue()


def _runtime_deps() -> Path:
    """boto3 for the AgentCore Runtime (linux/arm64; pure-Python wheels)."""
    d = BUILD / "runtime-deps"
    if not (d / "boto3").exists():
        d.mkdir(parents=True, exist_ok=True)
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "--target", str(d), "--platform", "manylinux2014_aarch64",
                        "--python-version", "3.13", "--only-binary=:all:", "--upgrade", "boto3"], check=True)
    return d


# --------------------------------------------------------------------------- IAM

def _trust(service: str, acct: str) -> str:
    stmt = {"Effect": "Allow", "Principal": {"Service": service}, "Action": "sts:AssumeRole"}
    if service == "bedrock-agentcore.amazonaws.com" or service == "bedrock.amazonaws.com":
        stmt["Condition"] = {"StringEquals": {"aws:SourceAccount": acct}}
    return json.dumps({"Version": "2012-10-17", "Statement": [stmt]})


def _role(name: str, trust: str, policy: dict, managed: list[str] | None = None) -> str:
    iam = session().client("iam")
    try:
        arn = iam.get_role(RoleName=name)["Role"]["Arn"]
        iam.update_assume_role_policy(RoleName=name, PolicyDocument=trust)
    except iam.exceptions.NoSuchEntityException:
        arn = iam.create_role(RoleName=name, AssumeRolePolicyDocument=trust, Tags=[{"Key": k, "Value": v} for k, v in TAGS.items()],
                              Description="Gcorp (hackathon) - created by gcorp aws up")["Role"]["Arn"]
    iam.put_role_policy(RoleName=name, PolicyName="gcorp", PolicyDocument=json.dumps({"Version": "2012-10-17", "Statement": policy["Statement"]}))
    for m in managed or []:
        iam.attach_role_policy(RoleName=name, PolicyArn=m)
    return arn


def _stmt(actions: list[str], resources: list[str] | str = "*") -> dict:
    return {"Effect": "Allow", "Action": actions, "Resource": resources}


# --------------------------------------------------------------------------- steps

def step_core(st: dict) -> None:
    s = session()
    ident = s.client("sts").get_caller_identity()
    st.update(account=ident["Account"], region=REGION, prefix=PREFIX)
    _say("account", f"{ident['Account']} · {REGION}")


def step_storage(st: dict) -> None:
    s = session()
    s3 = s.client("s3")
    bucket = f"{PREFIX}-{st['account']}-{REGION}"
    try:
        s3.head_bucket(Bucket=bucket)
    except Exception:
        s3.create_bucket(Bucket=bucket, CreateBucketConfiguration={"LocationConstraint": REGION})
        s3.put_public_access_block(Bucket=bucket, PublicAccessBlockConfiguration={k: True for k in (
            "BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets")})
        s3.put_bucket_tagging(Bucket=bucket, Tagging={"TagSet": [{"Key": k, "Value": v} for k, v in TAGS.items()]})
    st["bucket"] = bucket
    ddb = s.client("dynamodb")
    tables = {"runs": (f"{PREFIX}-runs", [("id", "S")]), "readings": (f"{PREFIX}-readings", [("zone", "S"), ("ts", "S")]),
              "alerts": (f"{PREFIX}-alerts", [("id", "S")])}
    st["tables"] = {}
    for key, (name, keys) in tables.items():
        try:
            ddb.describe_table(TableName=name)
        except ddb.exceptions.ResourceNotFoundException:
            ddb.create_table(TableName=name, BillingMode="PAY_PER_REQUEST",
                             AttributeDefinitions=[{"AttributeName": k, "AttributeType": t} for k, t in keys],
                             KeySchema=[{"AttributeName": k, "KeyType": "HASH" if i == 0 else "RANGE"} for i, (k, _) in enumerate(keys)],
                             Tags=[{"Key": k, "Value": v} for k, v in TAGS.items()])
            ddb.get_waiter("table_exists").wait(TableName=name)
            if key == "readings":
                ddb.update_time_to_live(TableName=name, TimeToLiveSpecification={"Enabled": True, "AttributeName": "ttl"})
        st["tables"][key] = name
    _say("storage", f"s3://{bucket} · dynamodb {', '.join(st['tables'].values())}")


def step_secrets(st: dict) -> None:
    """OpenAQ key from backend/.env -> SSM SecureString. The value is never printed."""
    name = f"/{PREFIX}/openaq-key"
    key = os.environ.get("OPENAQ_API_KEY")
    env = BACKEND / ".env"
    if not key and env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("OPENAQ_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"')
    if not key:
        _say("secrets", "no OPENAQ_API_KEY in backend/.env — ingest will use modelled data only")
        return
    session().client("ssm").put_parameter(Name=name, Value=key, Type="SecureString", Overwrite=True, Description="OpenAQ API key for gcorp ingest")
    st["openaqParam"] = name
    _say("secrets", f"OpenAQ key stored as SSM SecureString {name}")


def step_alerts(st: dict, email: str | None = None) -> None:
    sns = session().client("sns")
    arn = sns.create_topic(Name=f"{PREFIX}-alerts", Tags=[{"Key": k, "Value": v} for k, v in TAGS.items()])["TopicArn"]
    st["topic"] = arn
    if email:
        subs = sns.list_subscriptions_by_topic(TopicArn=arn)["Subscriptions"]
        if not any(x["Endpoint"] == email for x in subs):
            sns.subscribe(TopicArn=arn, Protocol="email", Endpoint=email)
            _say("alerts", f"confirmation email sent to {email} — click it to receive alerts")
    _say("alerts", f"SNS {arn.rsplit(':', 1)[-1]}")


def step_iam(st: dict) -> None:
    acct, b, t = st["account"], st["bucket"], st["tables"]
    tarn = lambda n: f"arn:aws:dynamodb:{REGION}:{acct}:table/{n}"
    roles = {}
    roles["lambda"] = _role(f"{PREFIX}-lambda", _trust("lambda.amazonaws.com", acct), {"Statement": [
        _stmt(["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:Query", "dynamodb:BatchWriteItem"], [tarn(n) for n in t.values()]),
        _stmt(["cloudwatch:PutMetricData"]),
        _stmt(["ssm:GetParameter"], f"arn:aws:ssm:{REGION}:{acct}:parameter/{PREFIX}/*"),
        _stmt(["s3:GetObject", "s3:PutObject"], f"arn:aws:s3:::{b}/*"),
    ]}, ["arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"])
    roles["states"] = _role(f"{PREFIX}-states", _trust("states.amazonaws.com", acct), {"Statement": [
        _stmt(["lambda:InvokeFunction"], f"arn:aws:lambda:{REGION}:{acct}:function:{PREFIX}-*"),
        _stmt(["sns:Publish"], st["topic"]),
        _stmt(["dynamodb:PutItem"], tarn(t["alerts"])),
    ]})
    roles["scheduler"] = _role(f"{PREFIX}-scheduler", _trust("scheduler.amazonaws.com", acct), {"Statement": [
        _stmt(["states:StartExecution"], f"arn:aws:states:{REGION}:{acct}:stateMachine:{PREFIX}-*")]})
    roles["gateway"] = _role(f"{PREFIX}-gateway", _trust("bedrock-agentcore.amazonaws.com", acct), {"Statement": [
        _stmt(["lambda:InvokeFunction"], f"arn:aws:lambda:{REGION}:{acct}:function:{PREFIX}-tools"),
        _stmt(["bedrock-agentcore:*Policy*", "bedrock-agentcore:AuthorizeAction", "bedrock-agentcore:PartiallyAuthorizeActions"]),
    ]})
    roles["runtime"] = _role(f"{PREFIX}-runtime", _trust("bedrock-agentcore.amazonaws.com", acct), {"Statement": [
        _stmt(["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:Converse", "bedrock:ApplyGuardrail"]),
        _stmt(["dynamodb:PutItem"], tarn(t["runs"])),
        _stmt(["s3:PutObject", "s3:GetObject"], f"arn:aws:s3:::{b}/*"),
        _stmt(["cloudwatch:PutMetricData", "xray:PutTraceSegments", "xray:PutTelemetryRecords",
               "logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams", "logs:DescribeLogGroups"]),
    ]})
    roles["kb"] = _role(f"{PREFIX}-kb", _trust("bedrock.amazonaws.com", acct), {"Statement": [
        _stmt(["s3:GetObject", "s3:ListBucket"], [f"arn:aws:s3:::{b}", f"arn:aws:s3:::{b}/*"]),
        _stmt(["bedrock:InvokeModel"], f"arn:aws:bedrock:{REGION}::foundation-model/amazon.titan-embed-text-v2:0"),
        _stmt(["s3vectors:*"], f"arn:aws:s3vectors:{REGION}:{acct}:bucket/{PREFIX}-*"),
    ]})
    # One identity per acting agent, so AgentCore Policy can write rules about *who* calls a tool.
    me = session().client("sts").get_caller_identity()["Arn"]
    caller_role = me.replace(":sts:", ":iam:").replace("assumed-role", "role").rsplit("/", 1)[0] if ":assumed-role/" in me else me
    agent_trust = json.dumps({"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": "sts:AssumeRole",
        "Principal": {"AWS": [f"arn:aws:iam::{acct}:root", f"arn:aws:iam::{acct}:role/{PREFIX}-runtime"]}}]})
    st["agentRoles"] = {}
    for a in ACTING_AGENTS:
        st["agentRoles"][a] = _role(f"{PREFIX}-agent-{a}", agent_trust, {"Statement": [
            _stmt(["bedrock-agentcore:InvokeGateway"], f"arn:aws:bedrock-agentcore:{REGION}:{acct}:gateway/*")]})
    st["roles"] = roles
    st["caller"] = caller_role
    _say("iam", f"{len(roles)} service roles · {len(ACTING_AGENTS)} agent identities")


def _lambda(st: dict, name: str, handler: str, code: bytes, env: dict, timeout: int, memory: int, desc: str) -> str:
    lam = session().client("lambda")
    fn = f"{PREFIX}-{name}"
    try:
        lam.get_function(FunctionName=fn)
        lam.update_function_code(FunctionName=fn, ZipFile=code, Architectures=["arm64"])
        lam.get_waiter("function_updated_v2").wait(FunctionName=fn)
        _retry(lam.update_function_configuration, FunctionName=fn, Handler=handler, Environment={"Variables": env}, Timeout=timeout,
               MemorySize=memory, Role=st["roles"]["lambda"], on=("ResourceConflict", "in progress"))
    except lam.exceptions.ResourceNotFoundException:
        _retry(lam.create_function, FunctionName=fn, Runtime="python3.13", Role=st["roles"]["lambda"], Handler=handler,
               Code={"ZipFile": code}, Timeout=timeout, MemorySize=memory, Architectures=["arm64"], Description=desc,
               Environment={"Variables": env}, Tags=TAGS)
    lam.get_waiter("function_active_v2").wait(FunctionName=fn)
    return lam.get_function(FunctionName=fn)["Configuration"]["FunctionArn"]


def step_lambdas(st: dict) -> None:
    code = _zip_core()
    st["lambdas"] = {
        "tools": _lambda(st, "tools", "gcorp.aws.handlers.tools.handler", code, {"GCORP_RUNS_DIR": "/tmp/runs", "GCORP_IN_CLOUD": "1"}, 60, 1024,
                         "Gcorp council tools for the AgentCore Gateway"),
        "ingest": _lambda(st, "ingest", "gcorp.aws.handlers.ingest.handler", code, {
            "GCORP_READINGS_TABLE": st["tables"]["readings"], "GCORP_ALERTS_TABLE": st["tables"]["alerts"],
            "GCORP_OPENAQ_PARAM": st.get("openaqParam", ""), "GCORP_ALERT_AQI": "300", "GCORP_IN_CLOUD": "1"}, 180, 512,
            "Gcorp hourly air ingest (Open-Meteo CAMS + OpenAQ)"),
    }
    _say("lambda", f"{PREFIX}-tools, {PREFIX}-ingest ({len(code) // 1024} KB package)")


WATCH_POLICY = "Ban trucks from entering at night"


def step_watch(st: dict) -> None:
    acct = st["account"]
    L, topic, alerts = st["lambdas"], st["topic"], st["tables"]["alerts"]
    definition = {
        "Comment": "Gcorp watch loop: ingest live air, re-assess the watched policy where the air is bad, alert (with cooldown).",
        "StartAt": "Ingest",
        "States": {
            "Ingest": {"Type": "Task", "Resource": "arn:aws:states:::lambda:invoke", "Parameters": {"FunctionName": L["ingest"], "Payload.$": "$"},
                       "ResultSelector": {"r.$": "$.Payload"}, "ResultPath": "$.ingest",
                       "Retry": [{"ErrorEquals": ["States.ALL"], "MaxAttempts": 2, "IntervalSeconds": 10, "BackoffRate": 2}], "Next": "Severe?"},
            "Severe?": {"Type": "Choice", "Choices": [{"And": [{"Variable": "$.ingest.r.severeCount", "NumericGreaterThan": 0},
                                                               {"Variable": "$.ingest.r.notify", "BooleanEquals": True}], "Next": "Reassess"}],
                        "Default": "Quiet"},
            "Reassess": {"Type": "Map", "ItemsPath": "$.ingest.r.severe", "MaxConcurrency": 3,
                         "ItemSelector": {"zone.$": "$$.Map.Item.Value.zone", "aqi.$": "$$.Map.Item.Value.aqi", "policy.$": "$$.Execution.Input.watch"},
                         "ItemProcessor": {"ProcessorConfig": {"Mode": "INLINE"}, "StartAt": "Council", "States": {
                             "Council": {"Type": "Task", "Resource": "arn:aws:states:::lambda:invoke",
                                         "Parameters": {"FunctionName": L["tools"], "Payload": {"tool": "assess", "policy.$": "$.policy", "zone.$": "$.zone"}},
                                         "ResultSelector": {"zone.$": "$.Payload.zone", "range.$": "States.Format('{}–{}', $.Payload.deltaLo, $.Payload.deltaHi)",
                                                            "grade.$": "$.Payload.confidence.grade", "title.$": "$.Payload.title"}, "End": True}}},
                         "ResultPath": "$.assessments", "Next": "Alert"},
            "Alert": {"Type": "Task", "Resource": "arn:aws:states:::sns:publish", "ResultPath": None, "Next": "Record",
                      "Parameters": {"TopicArn": topic, "Subject": "Gcorp air alert",
                                     "Message.$": "States.Format('Worst zone: {} at AQI {} ({}). The council re-assessed \"{}\" for each zone over the threshold. Results: {}', $.ingest.r.worst.zone, $.ingest.r.worst.aqi, $.ingest.r.worst.band, $$.Execution.Input.watch, States.JsonToString($.assessments))"}},
            "Record": {"Type": "Task", "Resource": "arn:aws:states:::dynamodb:putItem", "ResultPath": None, "End": True,
                       "Parameters": {"TableName": alerts, "Item": {
                           "id": {"S.$": "$$.Execution.Name"}, "ts": {"S.$": "$.ingest.r.ts"}, "zone": {"S.$": "$.ingest.r.worst.zone"},
                           "aqi": {"N.$": "States.Format('{}', $.ingest.r.worst.aqi)"}, "band": {"S.$": "$.ingest.r.worst.band"},
                           "severeCount": {"N.$": "States.Format('{}', $.ingest.r.severeCount)"},
                           "policy": {"S.$": "$$.Execution.Input.watch"}, "assessments": {"S.$": "States.JsonToString($.assessments)"}}}},
            "Quiet": {"Type": "Succeed"},
        },
    }
    sfn = session().client("stepfunctions")
    name = f"{PREFIX}-watch"
    arn = f"arn:aws:states:{REGION}:{acct}:stateMachine:{name}"
    try:
        sfn.describe_state_machine(stateMachineArn=arn)
        sfn.update_state_machine(stateMachineArn=arn, definition=json.dumps(definition), roleArn=st["roles"]["states"])
    except sfn.exceptions.StateMachineDoesNotExist:
        arn = _retry(sfn.create_state_machine, name=name, definition=json.dumps(definition), roleArn=st["roles"]["states"], type="STANDARD",
                     tags=[{"key": k, "value": v} for k, v in TAGS.items()], on=("AccessDenied", "not authorized", "InvalidDefinition"))["stateMachineArn"]
    st["stateMachine"] = arn
    sch = session().client("scheduler")
    target = {"Arn": arn, "RoleArn": st["roles"]["scheduler"], "Input": json.dumps({"watch": WATCH_POLICY})}
    kw = dict(Name=f"{PREFIX}-hourly", ScheduleExpression="rate(1 hour)", FlexibleTimeWindow={"Mode": "FLEXIBLE", "MaximumWindowInMinutes": 10},
              Target=target, State="ENABLED", Description="Gcorp: hourly air ingest + watch loop")
    try:
        sch.get_schedule(Name=kw["Name"])
        _retry(sch.update_schedule, **kw)
    except sch.exceptions.ResourceNotFoundException:
        _retry(sch.create_schedule, **kw)
    st["schedule"] = kw["Name"]
    _say("watch", f"Step Functions {name} · Scheduler rate(1 hour)")


def step_dashboard(st: dict) -> None:
    acct = st["account"]
    m = lambda name, stat="Average", label=None: ["Gcorp", name, {"stat": stat, "label": label or name}]
    widgets = [
        {"type": "text", "x": 0, "y": 0, "width": 24, "height": 2, "properties": {"markdown":
            "# Gcorp · air policy pre-check\nLive Delhi air (Open-Meteo CAMS + OpenAQ) and what the council did with it. Numbers in the council are always sourced; this board shows the plumbing."}},
        {"type": "metric", "x": 0, "y": 2, "width": 12, "height": 6, "properties": {"title": "Delhi AQI (CPCB, 24h PM2.5)", "region": REGION, "view": "timeSeries",
            "metrics": [m("CityMaxAQI", "Maximum", "worst zone"), m("CityMeanAQI", "Average", "city mean")], "period": 3600,
            "annotations": {"horizontal": [{"value": 300, "label": "Very poor", "color": "#e8431b"}, {"value": 400, "label": "Severe", "color": "#7a1f0b"}]}}},
        {"type": "metric", "x": 12, "y": 2, "width": 12, "height": 6, "properties": {"title": "Council verdicts", "region": REGION, "view": "timeSeries", "stacked": True,
            "metrics": [m("ClaimsAccepted", "Sum", "accepted"), m("ClaimsRejected", "Sum", "rejected"), m("OpenQuestions", "Sum", "open questions")], "period": 3600}},
        {"type": "metric", "x": 0, "y": 8, "width": 8, "height": 5, "properties": {"title": "Runs and confidence", "region": REGION,
            "metrics": [m("Runs", "Sum", "runs"), [*m("Confidence", "Average", "confidence score")[:2], {"stat": "Average", "yAxis": "right", "label": "confidence"}]], "period": 3600}},
        {"type": "metric", "x": 8, "y": 8, "width": 8, "height": 5, "properties": {"title": "Watch loop (Step Functions)", "region": REGION,
            "metrics": [["AWS/States", "ExecutionsSucceeded", "StateMachineArn", st["stateMachine"], {"stat": "Sum"}],
                        ["AWS/States", "ExecutionsFailed", "StateMachineArn", st["stateMachine"], {"stat": "Sum"}]], "period": 3600}},
        {"type": "metric", "x": 16, "y": 8, "width": 8, "height": 5, "properties": {"title": "Tools Lambda", "region": REGION,
            "metrics": [["AWS/Lambda", "Invocations", "FunctionName", f"{PREFIX}-tools", {"stat": "Sum"}],
                        ["AWS/Lambda", "Errors", "FunctionName", f"{PREFIX}-tools", {"stat": "Sum"}],
                        ["AWS/Lambda", "Duration", "FunctionName", f"{PREFIX}-tools", {"stat": "p90", "yAxis": "right"}]], "period": 3600}},
        {"type": "metric", "x": 0, "y": 13, "width": 8, "height": 5, "properties": {"title": "Live data coverage", "region": REGION,
            "metrics": [m("MeasuredZones", "Maximum", "zones with a fresh measured reading")], "period": 3600}},
    ]
    session().client("cloudwatch").put_dashboard(DashboardName=PREFIX, DashboardBody=json.dumps({"widgets": widgets}))
    st["dashboard"] = f"https://{REGION}.console.aws.amazon.com/cloudwatch/home?region={REGION}#dashboards/dashboard/{PREFIX}"
    _say("dashboard", f"CloudWatch dashboard '{PREFIX}' (account {acct})")


def step_guardrail(st: dict) -> None:
    b = session().client("bedrock")
    name = f"{PREFIX}-grounding"
    gid = next((g["id"] for g in b.list_guardrails()["guardrails"] if g["name"] == name), None)
    cfg = dict(
        description="Second check on accepted council claims: is the sentence supported by the sources it cites?",
        contextualGroundingPolicyConfig={"filtersConfig": [{"type": "GROUNDING", "threshold": 0.6}]},
        topicPolicyConfig={"topicsConfig": [{"name": "Individual medical advice", "type": "DENY",
            "definition": "Advice to a specific person about their own diagnosis, medication or treatment.",
            "examples": ["Should my son stop his inhaler?", "What dose of steroids should I take during smog?"]}]},
        blockedInputMessaging="Gcorp assesses policies, not individual health questions.",
        blockedOutputsMessaging="This claim is not supported by the sources it cites.")
    if gid:
        b.update_guardrail(guardrailIdentifier=gid, name=name, **cfg)
    else:
        gid = b.create_guardrail(name=name, tags=[{"key": k, "value": v} for k, v in TAGS.items()], **cfg)["guardrailId"]
    ver = b.create_guardrail_version(guardrailIdentifier=gid, description="gcorp aws up")["version"]
    st["guardrail"] = {"id": gid, "version": ver}
    _say("guardrail", f"{name} v{ver} (contextual grounding ≥0.6)")


def _kb_docs(st: dict) -> int:
    """One markdown file per ledger row + the role contracts, for the Knowledge Base."""
    from .. import ledger
    from ..council import AGENTS
    s3 = session().client("s3")
    n = 0
    for r in ledger.all_rows():
        body = (f"# {r['id']} · {r['label']}\n\nValue: {r.get('value')} {r.get('unit') or ''}\nScope: {r.get('scopeLevel', 'city')}\n"
                f"Status: {r.get('status', 'demo')}\nSource: {r.get('source', '')}\n\n{r.get('note', '')}\n")
        s3.put_object(Bucket=st["bucket"], Key=f"kb/ledger/{r['id']}.md", Body=body.encode(), ContentType="text/markdown")
        n += 1
    for aid, a in AGENTS.items():
        s3.put_object(Bucket=st["bucket"], Key=f"kb/roles/{aid}.md", ContentType="text/markdown",
                      Body=f"# {a['name']}\n\n{a['role']}\n\nTools: {', '.join(a['tools'])}\nMay change: {', '.join(a['mayChange']) or 'nothing'}\n\n{a['contract']}\n".encode())
        n += 1
    return n


def step_kb(st: dict) -> None:
    s = session()
    acct = st["account"]
    sv = s.client("s3vectors")
    vb = f"{PREFIX}-vectors-{acct}"
    try:
        sv.get_vector_bucket(vectorBucketName=vb)
    except Exception:
        sv.create_vector_bucket(vectorBucketName=vb)
    idx = "ledger"
    try:
        sv.get_index(vectorBucketName=vb, indexName=idx)
    except Exception:
        sv.create_index(vectorBucketName=vb, indexName=idx, dataType="float32", dimension=1024, distanceMetric="cosine",
                        metadataConfiguration={"nonFilterableMetadataKeys": ["AMAZON_BEDROCK_TEXT", "AMAZON_BEDROCK_METADATA"]})
    index_arn = sv.get_index(vectorBucketName=vb, indexName=idx)["index"]["indexArn"]
    docs = _kb_docs(st)
    ag = s.client("bedrock-agent")
    name = f"{PREFIX}-ledger"
    kb = next((k for k in ag.list_knowledge_bases()["knowledgeBaseSummaries"] if k["name"] == name), None)
    if kb:
        kb_id = kb["knowledgeBaseId"]
    else:
        kb_id = _retry(ag.create_knowledge_base, name=name, roleArn=st["roles"]["kb"],
                       description="Gcorp source ledger and role contracts (S3 Vectors)",
                       knowledgeBaseConfiguration={"type": "VECTOR", "vectorKnowledgeBaseConfiguration": {
                           "embeddingModelArn": f"arn:aws:bedrock:{REGION}::foundation-model/amazon.titan-embed-text-v2:0"}},
                       storageConfiguration={"type": "S3_VECTORS", "s3VectorsConfiguration": {"indexArn": index_arn}},
                       tags=TAGS)["knowledgeBase"]["knowledgeBaseId"]
    for _ in range(30):
        if ag.get_knowledge_base(knowledgeBaseId=kb_id)["knowledgeBase"]["status"] == "ACTIVE":
            break
        time.sleep(4)
    ds = ag.list_data_sources(knowledgeBaseId=kb_id)["dataSourceSummaries"]
    ds_id = ds[0]["dataSourceId"] if ds else ag.create_data_source(
        knowledgeBaseId=kb_id, name=f"{PREFIX}-kb-docs",
        dataSourceConfiguration={"type": "S3", "s3Configuration": {"bucketArn": f"arn:aws:s3:::{st['bucket']}", "inclusionPrefixes": ["kb/"]}},
        vectorIngestionConfiguration={"chunkingConfiguration": {"chunkingStrategy": "NONE"}})["dataSource"]["dataSourceId"]
    st["kb"] = {"id": kb_id, "dataSource": ds_id, "vectorBucket": vb, "index": idx}
    try:
        job = ag.start_ingestion_job(knowledgeBaseId=kb_id, dataSourceId=ds_id)["ingestionJob"]["ingestionJobId"]
        st["kb"]["lastJob"] = job
        _say("kb", f"{name} on S3 Vectors · {docs} docs · ingestion {job} started")
    except Exception as e:
        _say("kb", f"{name} on S3 Vectors · {docs} docs · ingestion not started ({str(e)[:80]}) — rerun `gcorp aws up --only kb`")


def step_gateway(st: dict) -> None:
    from .handlers.tools import SCHEMAS
    c = session().client("bedrock-agentcore-control")
    name = f"{PREFIX}-council"
    gw = next((g for g in c.list_gateways()["items"] if g["name"] == name), None)
    if gw:
        gid = gw["gatewayId"]
    else:
        gid = _retry(c.create_gateway, name=name, roleArn=st["roles"]["gateway"], protocolType="MCP", authorizerType="AWS_IAM",
                     description="Gcorp council tools; role contracts enforced by AgentCore Policy",
                     protocolConfiguration={"mcp": {"instructions": "Tools for pre-checking Delhi air policies. Figures must cite ledger rows."}},
                     exceptionLevel="DEBUG", tags=TAGS)["gatewayId"]
    for _ in range(40):
        g = c.get_gateway(gatewayIdentifier=gid)
        if g["status"] in ("READY", "FAILED"):
            break
        time.sleep(4)
    target = "council"
    tg = next((t for t in c.list_gateway_targets(gatewayIdentifier=gid)["items"] if t["name"] == target), None)
    cfg = {"mcp": {"lambda": {"lambdaArn": st["lambdas"]["tools"], "toolSchema": {"inlinePayload": SCHEMAS}}}}
    if tg:
        _retry(c.update_gateway_target, gatewayIdentifier=gid, targetId=tg["targetId"], name=target, targetConfiguration=cfg,
               credentialProviderConfigurations=[{"credentialProviderType": "GATEWAY_IAM_ROLE"}], on=("Conflict", "in progress", "ValidationException"))
    else:
        _retry(c.create_gateway_target, gatewayIdentifier=gid, name=target, description="Ledger, simulator, verifier and parameter changes",
               targetConfiguration=cfg, credentialProviderConfigurations=[{"credentialProviderType": "GATEWAY_IAM_ROLE"}])
    st["gateway"] = {"id": gid, "arn": g["gatewayArn"], "url": g["gatewayUrl"], "target": target}
    _say("gateway", f"{name} (MCP, IAM auth) · target '{target}' with {len(SCHEMAS)} tools")


def cedar_policies(st: dict) -> dict[str, str]:
    """Role contracts as Cedar: who may call which tool, with which arguments.

    Agents call the gateway as their own IAM role (assumed per agent), so the Cedar
    principal is an AgentCore::IamEntity whose id is that session's ARN.
    """
    from ..council import AGENTS
    gw = st["gateway"]["arn"]
    t = st["gateway"]["target"]
    who = lambda a: f'(principal.id like "*/{PREFIX}-agent-{a}" || principal.id like "*/{PREFIX}-agent-{a}/*")'
    council = f'(principal.id like "*/{PREFIX}-agent-*" || principal.id like "*:role/{PREFIX}-agent-*")'
    head = lambda tool: (f'permit(principal is AgentCore::IamEntity, action == AgentCore::Action::"{t}___{tool}", '
                         f'resource == AgentCore::Gateway::"{gw}")')
    out = {}
    # Council members (and nobody else) may read the ledger, run the simulator and submit claims to the verifier.
    for tool in ("ledger_lookup", "ledger_search", "simulate", "verify_claim"):
        out[f"read_{tool}"] = f"{head(tool)} when {{ {council} }};"
    # Only the planner (the human in the loop) may launch a full assessment through the gateway.
    out["assess_planner"] = f"{head('assess')} when {{ {who('planner')} }};"
    # Parameter changes: each role only for the inputs its contract names.
    for aid, a in AGENTS.items():
        keys = a["mayChange"]
        if aid not in ACTING_AGENTS or not keys:
            continue
        allowed = " || ".join(f'context.input.key == "{k}"' for k in keys)
        out[f"propose_{aid}"] = f"{head('propose_change')} when {{ {who(aid)} && context.input has key && ({allowed}) }};"
    return out


def _policies(c, pid: str) -> list[dict]:
    out, tok = [], None
    while True:
        r = c.list_policies(policyEngineId=pid, **({"nextToken": tok} if tok else {}))
        out += r.get("policies", [])
        tok = r.get("nextToken")
        if not tok:
            return out


def step_policy(st: dict) -> None:
    c = session().client("bedrock-agentcore-control")
    name = f"{PREFIX}_contracts"
    pe = next((p for p in c.list_policy_engines()["policyEngines"] if p["name"] == name), None)
    pid = pe["policyEngineId"] if pe else c.create_policy_engine(name=name, description="Gcorp role contracts in Cedar")["policyEngineId"]
    for _ in range(30):
        p = c.get_policy_engine(policyEngineId=pid)
        if p["status"] in ("ACTIVE", "READY", "FAILED", "CREATE_FAILED"):
            break
        time.sleep(3)
    existing = {x["name"]: x for x in _policies(c, pid)}
    made, failed = 0, []
    wanted = cedar_policies(st)
    for pname, x in list(existing.items()):
        if pname not in wanted:  # stale or probe policies
            c.delete_policy(policyEngineId=pid, policyId=x["policyId"])
            existing.pop(pname)
    for pname, stmt in wanted.items():
        try:
            if pname in existing and existing[pname].get("status", "").endswith("FAILED"):
                c.delete_policy(policyEngineId=pid, policyId=existing[pname]["policyId"])
                time.sleep(3)
                existing.pop(pname)
            if pname in existing:
                c.update_policy(policyEngineId=pid, policyId=existing[pname]["policyId"], definition={"cedar": {"statement": stmt}})
            else:
                c.create_policy(policyEngineId=pid, name=pname, definition={"cedar": {"statement": stmt}}, validationMode="FAIL_ON_ANY_FINDINGS")
            made += 1
        except Exception as e:
            failed.append(f"{pname}: {str(e)[:200]}")
    st["policyEngine"] = {"id": pid, "arn": p["policyEngineArn"], "policies": made}
    g = c.get_gateway(gatewayIdentifier=st["gateway"]["id"])
    if (g.get("policyEngineConfiguration") or {}).get("arn") != p["policyEngineArn"]:
        _retry(c.update_gateway, gatewayIdentifier=g["gatewayId"], name=g["name"], roleArn=g["roleArn"], protocolType=g["protocolType"],
               authorizerType=g["authorizerType"], protocolConfiguration=g.get("protocolConfiguration", {}), exceptionLevel="DEBUG",
               policyEngineConfiguration={"arn": p["policyEngineArn"], "mode": "ENFORCE"}, on=("Conflict", "in progress", "ValidationException", "AccessDenied"))
    _say("policy", f"{name}: {made} Cedar policies, ENFORCE on the gateway" + (f" · {len(failed)} failed" if failed else ""))
    for f in failed:
        _say("", f"  ! {f}")
    st["policyEngine"]["failed"] = failed


def step_runtime(st: dict) -> None:
    deps = _runtime_deps()
    cloud_state = {k: st[k] for k in ("account", "region", "bucket", "tables", "guardrail") if k in st}
    main = b"from gcorp.aws.handlers.runtime import main\n\nif __name__ == '__main__':\n    main()\n"
    code = _zip_core({"main.py": main}, deps)
    s3 = session().client("s3")
    key = f"code/runtime-{int(time.time())}.zip"
    s3.put_object(Bucket=st["bucket"], Key=key, Body=code)
    c = session().client("bedrock-agentcore-control")
    name = f"{PREFIX}_engine"
    art = {"codeConfiguration": {"code": {"s3": {"bucket": st["bucket"], "prefix": key}}, "runtime": "PYTHON_3_13", "entryPoint": ["main.py"]}}
    env = {"GCORP_IN_CLOUD": "1", "GCORP_AWS_REGION": REGION, "GCORP_AWS_STATE_JSON": json.dumps(cloud_state)}
    rt = next((r for r in c.list_agent_runtimes()["agentRuntimes"] if r["agentRuntimeName"] == name), None)
    kw = dict(agentRuntimeArtifact=art, roleArn=st["roles"]["runtime"], networkConfiguration={"networkMode": "PUBLIC"},
              protocolConfiguration={"serverProtocol": "HTTP"}, environmentVariables=env,
              lifecycleConfiguration={"idleRuntimeSessionTimeout": 300, "maxLifetime": 1800},
              description="Gcorp engine: compiler, simulator, council, verifier")
    if rt:
        r = _retry(c.update_agent_runtime, agentRuntimeId=rt["agentRuntimeId"], **kw)
    else:
        r = _retry(c.create_agent_runtime, agentRuntimeName=name, tags=TAGS, **kw)
    rid = r["agentRuntimeId"]
    for _ in range(60):
        g = c.get_agent_runtime(agentRuntimeId=rid)
        if g["status"] in ("READY", "CREATE_FAILED", "UPDATE_FAILED"):
            break
        time.sleep(5)
    st["runtime"] = {"id": rid, "arn": g["agentRuntimeArn"], "status": g["status"], "package": f"s3://{st['bucket']}/{key}"}
    _say("runtime", f"{name} · {g['status']} · {len(code) // 1024 // 1024} MB code package")
    if g["status"] != "READY":
        _say("", f"  ! {g.get('failureReason', '')}")


STEPS = {"core": step_core, "storage": step_storage, "secrets": step_secrets, "alerts": step_alerts, "iam": step_iam,
         "lambdas": step_lambdas, "watch": step_watch, "dashboard": step_dashboard, "guardrail": step_guardrail,
         "kb": step_kb, "gateway": step_gateway, "policy": step_policy, "runtime": step_runtime}


def up(only: list[str] | None = None, email: str | None = None) -> dict:
    st = state()
    names = list(STEPS) if not only else ["core"] + [n for n in only if n != "core"]
    for n in names:
        t0 = time.time()
        try:
            STEPS[n](st, email) if n == "alerts" else STEPS[n](st)
        except Exception as e:
            _say(n, f"FAILED: {type(e).__name__}: {str(e)[:300]}")
            st.setdefault("errors", {})[n] = str(e)[:500]
            save(st)
            continue
        st.setdefault("errors", {}).pop(n, None)
        st.setdefault("steps", {})[n] = round(time.time() - t0, 1)
        save(st)
    return st


# --------------------------------------------------------------------------- teardown

def down() -> None:
    """Delete everything `up` created. Safe to rerun."""
    st = state()
    s = session()
    acct = st.get("account")

    def quiet(label, fn, *a, **kw):
        try:
            fn(*a, **kw)
            _say("delete", label)
        except Exception as e:
            if "NotFound" not in type(e).__name__ and "not found" not in str(e).lower():
                _say("delete", f"{label}: {str(e)[:120]}")

    c = s.client("bedrock-agentcore-control")
    if st.get("runtime"):
        quiet("agentcore runtime", c.delete_agent_runtime, agentRuntimeId=st["runtime"]["id"])
    if st.get("gateway"):
        gid = st["gateway"]["id"]
        try:
            for t in c.list_gateway_targets(gatewayIdentifier=gid)["items"]:
                quiet(f"gateway target {t['name']}", c.delete_gateway_target, gatewayIdentifier=gid, targetId=t["targetId"])
            time.sleep(5)
        except Exception:
            pass
        quiet("agentcore gateway", c.delete_gateway, gatewayIdentifier=gid)
    if st.get("policyEngine"):
        pid = st["policyEngine"]["id"]
        try:
            for p in _policies(c, pid):
                quiet(f"policy {p['name']}", c.delete_policy, policyEngineId=pid, policyId=p["policyId"])
            time.sleep(5)
        except Exception:
            pass
        quiet("policy engine", c.delete_policy_engine, policyEngineId=pid)
    if st.get("kb"):
        ag = s.client("bedrock-agent")
        quiet("kb data source", ag.delete_data_source, knowledgeBaseId=st["kb"]["id"], dataSourceId=st["kb"]["dataSource"])
        quiet("knowledge base", ag.delete_knowledge_base, knowledgeBaseId=st["kb"]["id"])
        sv = s.client("s3vectors")
        quiet("vector index", sv.delete_index, vectorBucketName=st["kb"]["vectorBucket"], indexName=st["kb"]["index"])
        quiet("vector bucket", sv.delete_vector_bucket, vectorBucketName=st["kb"]["vectorBucket"])
    if st.get("guardrail"):
        quiet("guardrail", s.client("bedrock").delete_guardrail, guardrailIdentifier=st["guardrail"]["id"])
    if st.get("schedule"):
        quiet("schedule", s.client("scheduler").delete_schedule, Name=st["schedule"])
    if st.get("stateMachine"):
        quiet("state machine", s.client("stepfunctions").delete_state_machine, stateMachineArn=st["stateMachine"])
    quiet("dashboard", s.client("cloudwatch").delete_dashboards, DashboardNames=[PREFIX])
    lam = s.client("lambda")
    for fn in ("tools", "ingest"):
        quiet(f"lambda {PREFIX}-{fn}", lam.delete_function, FunctionName=f"{PREFIX}-{fn}")
    if st.get("topic"):
        quiet("sns topic", s.client("sns").delete_topic, TopicArn=st["topic"])
    if st.get("openaqParam"):
        quiet("ssm parameter", s.client("ssm").delete_parameter, Name=st["openaqParam"])
    ddb = s.client("dynamodb")
    for t in (st.get("tables") or {}).values():
        quiet(f"table {t}", ddb.delete_table, TableName=t)
    if st.get("bucket"):
        s3r = s.resource("s3")
        try:
            s3r.Bucket(st["bucket"]).objects.all().delete()
        except Exception:
            pass
        quiet(f"bucket {st['bucket']}", s.client("s3").delete_bucket, Bucket=st["bucket"])
    iam = s.client("iam")
    names = [f"{PREFIX}-{r}" for r in ("lambda", "states", "scheduler", "gateway", "runtime", "kb")] + [f"{PREFIX}-agent-{a}" for a in ACTING_AGENTS]
    for n in names:
        try:
            for p in iam.list_attached_role_policies(RoleName=n)["AttachedPolicies"]:
                iam.detach_role_policy(RoleName=n, PolicyArn=p["PolicyArn"])
            for p in iam.list_role_policies(RoleName=n)["PolicyNames"]:
                iam.delete_role_policy(RoleName=n, PolicyName=p)
            iam.delete_role(RoleName=n)
        except Exception:
            pass
    _say("delete", f"{len(names)} IAM roles")
    from . import STATE
    if STATE.exists():
        STATE.rename(STATE.with_suffix(".deleted.json"))
    _say("done", f"account {acct} is back to the budget alarm only (the budget itself is kept)")
