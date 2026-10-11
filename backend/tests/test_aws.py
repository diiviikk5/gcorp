"""The AWS layer, tested without AWS: handlers, Cedar generation, fallbacks."""

from gcorp.aws.handlers import band, pm_to_aqi
from gcorp.aws.handlers.tools import SCHEMAS, handler
from gcorp.aws.provision import cedar_policies
from gcorp.council import AGENTS, Context
from gcorp.council.bedrock import BedrockBackend
from gcorp.compiler import compile_policy
from gcorp.simulator import simulate


def test_cpcb_aqi():
    assert pm_to_aqi(30) == 50 and pm_to_aqi(60) == 100 and pm_to_aqi(250) == 400
    assert band(pm_to_aqi(171.7)) == "Very poor"


def test_tools_handler_matches_schemas():
    assert {s["name"] for s in SCHEMAS} == {"ledger_lookup", "ledger_search", "simulate", "verify_claim", "propose_change", "assess"}
    assert handler({"tool": "ledger_lookup", "rowId": "L-011"}, None)["found"]
    assert handler({"tool": "verify_claim", "text": "Diversion was 30% after the expressway."}, None)["status"] == "rejected"
    s = handler({"tool": "simulate", "policy": "Ban trucks at night in Anand Vihar"}, None)["summary"]
    assert s["deltaHi"] > s["deltaLo"] > 0
    assert "error" in handler({"tool": "nope"}, None)


def test_cedar_mirrors_role_contracts():
    st = {"account": "123456789012", "gateway": {"arn": "arn:aws:bedrock-agentcore:ap-southeast-2:123456789012:gateway/g", "target": "council"}}
    pol = cedar_policies(st)
    movers = {a for a, x in AGENTS.items() if x["mayChange"] and a != "compiler"}
    assert {k.removeprefix("propose_") for k in pol if k.startswith("propose_")} <= movers
    ext = pol["propose_externalities"]
    assert 'context.input.key == "regionalPct"' in ext and "gcorp-agent-externalities" in ext
    assert "economist" not in " ".join(k for k in pol if k.startswith("propose_"))
    assert all("principal is AgentCore::IamEntity" in v for v in pol.values())  # never "any principal"


class _Down:
    def converse(self, **kw):
        raise RuntimeError("model unavailable")


def test_bedrock_backend_falls_back_to_playbooks():
    sc = compile_policy("Ban trucks from entering Anand Vihar at night", "anandvihar")
    ctx = Context(sc, simulate(sc))
    b = BedrockBackend(client=_Down())
    drafts = b.drafts("engineer", ctx)
    assert drafts and b.used["engineer"].startswith("rules")


class _Overreach:
    """Only the economist overreaches: it tries to move the regional smoke share."""

    def converse(self, **kw):
        prompt = kw["messages"][0]["content"][0]["text"]
        if "Your role: Economist" in prompt:
            text = '{"drafts": [{"text": "Smoke dominates [[L-007]].", "lookups": ["L-007"], "scope": "city", "changes": {"regionalPct": 99}}]}'
        else:
            text = '{"drafts": [{"text": "Diversion after the expressway opened was [[L-011]].", "lookups": ["L-011"], "scope": "city"}]}'
        return {"output": {"message": {"content": [{"text": text}]}}}


def test_overreach_is_refused_on_record_offline():
    """A model proposing an input outside its contract: the claim stands, the change does not."""
    from gcorp.orchestrator import execute
    run = execute("Ban trucks from entering Anand Vihar at night", "anandvihar", backend=BedrockBackend(client=_Overreach()), cloud=False)
    eco = [c for c in run.claims.values() if c["agent"] == "economist"]
    assert eco and eco[0]["status"] == "accepted" and eco[0]["changes"]["to"] == 99
    assert run.overrides.get("regionalPct") != 99
    assert "regionalPct" not in AGENTS["economist"]["mayChange"]
