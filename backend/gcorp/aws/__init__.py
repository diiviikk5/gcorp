"""Gcorp on AWS.

Everything the engine does locally can also run against an AWS account:

  AgentCore Gateway   the council's tools (ledger, simulator, verifier, param changes) as MCP tools
  AgentCore Policy    role contracts enforced in Cedar, per agent identity, outside our own code
  AgentCore Runtime   the whole engine hosted as an agent
  Bedrock             Guardrails grounding on accepted claims, a Knowledge Base over the ledger
                      (S3 Vectors), and a Claude backend the verifier still gates
  Live loop           Scheduler -> Step Functions -> Lambda ingest -> DynamoDB, SNS, CloudWatch
  Archive             S3 for run artifacts, Polly for spoken briefs

`gcorp aws up` provisions it (idempotent), `gcorp aws status` shows it, `gcorp aws down` removes it.
Resource ids live in ~/.gcorp/aws.json. Nothing here is needed to run Gcorp offline.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

REGION = os.environ.get("GCORP_AWS_REGION", "ap-southeast-2")
PROFILE = os.environ.get("GCORP_AWS_PROFILE", "gcorp")
PREFIX = "gcorp"
STATE = Path(os.environ.get("GCORP_AWS_STATE") or Path.home() / ".gcorp" / "aws.json")
IN_CLOUD = bool(os.environ.get("AWS_LAMBDA_FUNCTION_NAME") or os.environ.get("GCORP_IN_CLOUD"))

# Agents that act through the gateway get their own IAM identity, so Cedar can tell them apart.
ACTING_AGENTS = ["compiler", "simulator", "apportionment", "engineer", "epidemiologist",
                 "economist", "externalities", "skeptic", "verifier", "writer", "planner"]


def session():
    import boto3
    if IN_CLOUD or os.environ.get("AWS_ACCESS_KEY_ID"):
        return boto3.Session(region_name=REGION)
    return boto3.Session(profile_name=PROFILE, region_name=REGION)


def state() -> dict:
    if IN_CLOUD:
        return json.loads(os.environ.get("GCORP_AWS_STATE_JSON", "{}"))
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save(st: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(st, indent=1), encoding="utf-8")


def enabled() -> bool:
    """Cloud features switch on once `gcorp aws up` has run (GCORP_AWS=0 forces them off)."""
    if os.environ.get("GCORP_AWS") == "0":
        return False
    try:
        import boto3  # noqa: F401
    except ImportError:
        return False
    return bool(state().get("account"))
