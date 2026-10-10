from fastapi.testclient import TestClient

from gcorp import verifier
from gcorp.api import app
from gcorp.compiler import compile_policy
from gcorp.orchestrator import execute
from gcorp.simulator import simulate

FLAGSHIP = "Ban diesel trucks from entering Anand Vihar at night for six months starting November"


def test_simulator_is_deterministic():
    sc = compile_policy(FLAGSHIP, "anandvihar")
    a, b = simulate(sc), simulate(sc)
    assert a.after_lo == b.after_lo and a.fingerprint == b.fingerprint
    assert 0 < a.summary.delta_lo < a.summary.delta_hi


def test_unknowns_are_flagged_not_guessed():
    sc = compile_policy("Restrict trucks in Okhla", "okhla")
    assert sc.params["durationDays"].origin == "unknown"
    assert sc.params["reductionPct"].origin == "unknown"


def test_verifier_rules():
    assert verifier.check("This cuts PM2.5 by about a third.").status == "rejected"
    assert verifier.check("Diversion was [[L-999]].").rule == "missing-row"
    assert verifier.check("Trucks dominate here [[L-002]].", scope="zone").rule == "scope-mismatch"
    assert verifier.check("This prevents asthma admissions.").status == "ask"
    assert verifier.check("Diversion was [[L-011]].").status == "accepted"


def test_debate_changes_inputs_and_reruns():
    r = execute(FLAGSHIP, "anandvihar")
    statuses = {c["status"] for c in r.claims.values()}
    assert {"accepted", "rejected", "ask"} <= statuses
    assert len(r.sims) == 2 and r.overrides


def test_api_roundtrip():
    with TestClient(app) as client:
        runs = client.get("/api/runs").json()
        assert len(runs) >= 4
        rid = runs[0]["id"]
        out = client.post(f"/api/runs/{rid}/interject", json={"text": "what if compliance is 90%?"}).json()
        assert any(e["type"] == "sim" for e in out["events"])


def test_role_contracts_are_enforced():
    import pytest
    from gcorp.council import AGENTS
    from gcorp.orchestrator import Recorder, Run
    from gcorp.compiler import compile_policy
    assert "verify" in AGENTS["verifier"]["tools"] and "sim.run" not in AGENTS["engineer"]["tools"]
    rec = Recorder(Run("r-test", "assessment", "now", compile_policy(FLAGSHIP, "anandvihar")))
    with pytest.raises(PermissionError):
        rec.action("engineer", "sim.run", "round 9")


def test_planning_engines():
    from gcorp.planning import breathe, optimise, track_record
    o = optimise("anandvihar", target=15, budget=2, months=3)
    assert o["portfolios"] and all(p["cost"] <= 2 for p in o["portfolios"])
    assert all(len({l for l in p["levers"] if l.startswith("truck")}) <= 1 for p in o["portfolios"])  # exclusive levers
    t = track_record()
    assert t["hitsCalibrated"] >= t["hits"]
    for c in t["cases"]:
        assert c["id"] not in c["calibratedFrom"]  # leave-one-out: never calibrated on itself
    b = breathe("anandvihar")
    assert len(b["hours"]) == 24 and 7 <= b["bestWindow"][0] <= 16


def test_interjection_rules():
    from gcorp.orchestrator import execute, interject
    r = execute(FLAGSHIP, "anandvihar")
    interject(r, "What if it's a windy week?")
    assert r.overrides.get("weather") == "windy" and max(r.sims) == 3


def test_verifier_ignores_pollutant_names_but_not_figures():
    assert verifier.check("Vehicles drive local PM2.5 here [[L-001]].").status == "accepted"
    assert verifier.check("NO2 near BS-IV trucks matters [[L-009]].").status == "accepted"
    assert verifier.check("PM2.5 falls by 30 here.").status == "rejected"
