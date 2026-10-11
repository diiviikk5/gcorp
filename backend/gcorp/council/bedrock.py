"""Bedrock as a council backend (Amazon Nova 2 Lite by default; any Converse model works).

Same `drafts(agent, ctx)` contract as RuleBackend. The model gets the agent's role
contract, the scenario, the simulator's summary and the ledger index (ids + labels,
never values), and must answer in JSON with provenance tokens instead of numbers.

Nothing is trusted: every draft still goes through the verifier, and parameter changes
are still limited to the role's `may_change`. If Bedrock is unavailable or the answer
is malformed, that agent falls back to its rule playbook and the draft says so.
"""

from __future__ import annotations

import json
import os
import re

from . import AGENTS, Context, Draft, RuleBackend

MODEL = os.environ.get("GCORP_BEDROCK_MODEL", "global.amazon.nova-2-lite-v1:0")
TOKEN = re.compile(r"\[\[([^\]]+)\]\]")

RULES = """You are one member of a council that pre-checks city air-quality policies for Delhi.
Hard rules (a verifier enforces them and rejects violations):
- Never write digits or number words. Every figure must be a token: [[L-xxx]] for a ledger row,
  [[sim:deltaRange]] [[sim:pctRange]] [[sim:zoneBefore]] [[sim:zoneAfterRange]] [[sim:ceiling]] [[sim:regional]]
  [[sim:spillover]] for simulator outputs, [[param:<key>]] for an input.
- Only cite ledger rows from the index you are given. Pollutant names like PM2.5 and NO2 are fine.
- Claims about a single zone must cite rows whose scope is zone-level or finer, or set scope "city".
- Health outcome claims need outcome data; if the ledger lacks it, say what evidence would settle it.
- One or two short claims, plain English, no hedging filler.
Answer with JSON only: {"drafts": [{"text": str, "lookups": [row ids], "scope": "city"|"zone", "changes": {key: value}}]}
`changes` may only use the input keys your contract allows; leave it empty otherwise."""


def _index() -> str:
    from .. import ledger
    return "\n".join(f"{r['id']} [{r.get('scopeLevel', 'city')}] {r['label']}" for r in ledger.all_rows())


class ModelBackend:
    """Shared prompt/parse logic; subclasses only implement `_complete(system, user) -> str`."""

    name = "model"

    def __init__(self, model: str | None = None, client=None):
        self.model = model
        self._client = client
        self.fallback = RuleBackend()
        self.used: dict[str, str] = {}  # agent -> "<provider>:<model>" | "rules (reason)"
        self._ix = None

    def _complete(self, system: str, user: str) -> str:
        raise NotImplementedError

    def _prompt(self, agent: str, c: Context) -> str:
        a = AGENTS[agent]
        s, sm = c.scenario, c.sim.summary
        params = "\n".join(f"- {p.label} ({k}): {p.value}{p.unit or ''} [{p.origin}]" for k, p in s.params.items())
        if self._ix is None:
            self._ix = _index()
        return (f"Your role: {a['name']}. Your question: {a['role']}\nYour contract:\n{a['contract']}\n"
                f"You may change these inputs: {', '.join(a['mayChange']) or 'none'}\n\n"
                f"Policy: {s.text}\nZone: {c.where}\nInputs:\n{params}\n"
                f"Simulator: coverage {sm.coverage}; tokens available as listed in the rules.\n\n"
                f"Ledger index (id [scope] label):\n{self._ix}\n\nWrite your drafts.")

    def drafts(self, agent: str, ctx: Context) -> list[Draft]:
        if agent not in AGENTS:
            return []
        try:
            raw = self._complete(RULES, self._prompt(agent, ctx))
            data = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
            out = []
            for d in data.get("drafts", [])[:2]:
                text = str(d.get("text", "")).strip()
                if not text:
                    continue
                cited = [t for t in TOKEN.findall(text) if t.startswith("L-")]
                # Not filtered here on purpose: an out-of-contract proposal is refused by AgentCore
                # Policy (cloud) or the local contract check (offline), and the refusal is on record.
                changes = dict(d.get("changes") or {})
                out.append(Draft(agent, text, list(dict.fromkeys(list(d.get("lookups") or []) + cited)),
                                 scope="zone" if d.get("scope") == "zone" else "city", changes=changes))
            self.used[agent] = f"{self.name}:{self.model}"
            return out or self.fallback.drafts(agent, ctx)
        except Exception as e:
            self.used[agent] = f"rules ({type(e).__name__})"
            return self.fallback.drafts(agent, ctx)


class BedrockBackend(ModelBackend):
    """Any Bedrock Converse model; Amazon Nova 2 Lite by default."""

    name = "bedrock"

    def __init__(self, model: str | None = None, client=None):
        super().__init__(model or MODEL, client)

    @property
    def client(self):
        if self._client is None:
            from ..aws import session
            self._client = session().client("bedrock-runtime")
        return self._client

    def _complete(self, system: str, user: str) -> str:
        r = self.client.converse(modelId=self.model, system=[{"text": system}],
                                 messages=[{"role": "user", "content": [{"text": user}]}],
                                 inferenceConfig={"maxTokens": 600, "temperature": 0.2})
        return r["output"]["message"]["content"][0]["text"]


def backend_for(name: str | None):
    """'rules' (default) | 'bedrock'."""
    return BedrockBackend() if name == "bedrock" else None
