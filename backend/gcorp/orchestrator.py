"""Runs the pipeline and records everything as an event stream.

Stages (each writes an artifact to runs/<run-id>/):
  1 Scope      scenario.json
  2 Simulate   results.round-<n>.json
  3 Challenge  objections.md
  4 Verify     claims.json
  5 Decide     brief.md

Event types match web/src/lib/types.ts RunEvent, plus `action` events that
show what an agent is doing (opening a ledger row, asking for a re-run,
submitting a claim). The Chamber view draws those.
"""

from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path

from . import ledger, verifier
from .compiler import compile_policy
from .council import AGENTS, Context, Draft, RuleBackend, zone_focus
from .rng import fnv1a
from .scenario import Scenario
from .simulator import simulate

RUNS = Path(os.environ.get("GCORP_RUNS_DIR") or Path(__file__).resolve().parent.parent / "runs")
ORDER = ["apportionment", "engineer", "epidemiologist", "economist", "externalities", "skeptic"]


@dataclass
class Run:
    id: str
    kind: str
    created_at: str
    scenario: Scenario
    events: list[dict] = field(default_factory=list)
    claims: dict[str, dict] = field(default_factory=dict)
    sims: dict[int, dict] = field(default_factory=dict)
    overrides: dict[str, float | str] = field(default_factory=dict)
    observed: dict | None = None
    t: int = 0
    msg_n: int = 0

    @property
    def current(self) -> Scenario:
        return self.scenario.with_changes(self.overrides) if self.overrides else self.scenario

    @property
    def duration(self) -> int:
        return self.events[-1]["t"] if self.events else 0

    def to_json(self, grids: bool = True) -> dict:
        return {
            "id": self.id, "kind": self.kind, "createdAt": self.created_at,
            "scenario": self.scenario.to_json(), "events": self.events, "claims": self.claims,
            "sims": {str(k): v if grids else {kk: vv for kk, vv in v.items() if kk not in ("before", "afterLo", "afterHi", "uncertainty")} for k, v in self.sims.items()},
            "finalOverrides": self.overrides, "duration": self.duration, "observed": self.observed,
            "confidence": confidence(self) if self.sims else None,
        }


class Recorder:
    def __init__(self, run: Run):
        self.r = run

    def emit(self, dt: int, **ev) -> dict:
        self.r.t += dt
        ev["t"] = self.r.t
        self.r.events.append(ev)
        return ev

    def stage(self, stage: str, status: str, dt: int = 400):
        self.emit(dt, type="stage", stage=stage, status=status)

    def action(self, agent: str, tool: str, target: str, detail: str = "", dt: int = 350):
        allowed = AGENTS.get(agent, {}).get("tools", [])
        if tool not in allowed:
            raise PermissionError(f"{agent} is not allowed to use {tool} (contract: council/roles/{agent}.md)")
        self.emit(dt, type="action", agent=agent, tool=tool, target=target, detail=detail)

    def message(self, agent: str, text: str, dt: int = 900, claim_id: str | None = None, focus: list[int] | None = None) -> str:
        self.r.msg_n += 1
        mid = f"m{self.r.msg_n}"
        ev = dict(type="message", id=mid, agent=agent, text=text, model=AGENTS[agent]["model"])
        if claim_id:
            ev["claimId"] = claim_id
        if focus:
            ev["focus"] = focus
        self.emit(dt, **ev)
        return mid


def _sim(run: Run, rec: Recorder, agent: str = "simulator") -> dict:
    n = len(run.sims) + 1
    sc = run.current
    rec.action(agent, "sim.run", f"round {n}", ", ".join(f"{k}={v}" for k, v in run.overrides.items()) or "initial inputs", dt=300)
    t0 = time.perf_counter()
    res = simulate(sc, n).to_json()
    res["fingerprint"] = fnv1a(sc.fingerprint + json.dumps(run.overrides, sort_keys=True))
    res["ms"] = round((time.perf_counter() - t0) * 1000, 1)
    run.sims[n] = res
    rec.emit(600, type="sim", round=n)
    _write(run, f"results.round-{n}.json", res)
    return res


def _debate(run: Run, rec: Recorder, drafts: list[Draft]) -> dict[str, float | str]:
    changes: dict[str, float | str] = {}
    for d in drafts:
        for ref in d.lookups:
            row = ledger.get(ref)
            rec.action(d.agent, "ledger.lookup", ref, row["label"] if row else "not in ledger", dt=320)
        cid = None
        if d.is_claim:
            cid = f"c{len(run.claims) + 1}"
            run.claims[cid] = {"id": cid, "agent": d.agent, "text": d.text, "status": "pending", "scope": d.scope}
            if d.changes:
                k, v = next(iter(d.changes.items()))
                frm = run.current.value(k)
                run.claims[cid]["changes"] = {"key": k, "from": frm, "to": v}
        rec.message(d.agent, d.text, dt=1100, claim_id=cid, focus=zone_focus(run.scenario, d.focus))
        if not cid:
            continue
        rec.action(d.agent, "claim.submit", cid, f"scope: {d.scope}", dt=300)
        rec.action("verifier", "verify", cid, "checking tokens, ledger rows and scope", dt=350)
        v = verifier.check(d.text, d.scope)
        run.claims[cid].update(status=v.status, reason=v.reason, rule=v.rule, ledgerRef=v.ledger_ref)
        ev = dict(type="verdict", claimId=cid, status=v.status, reason=v.reason, rule=v.rule)
        if v.ledger_ref:
            ev["ledgerRef"] = v.ledger_ref
        rec.emit(900, **ev)
        if v.status == "accepted" and d.changes:
            for k, val in d.changes.items():
                if k not in AGENTS[d.agent]["mayChange"]:
                    continue  # the role's contract does not let it move this input
                frm = run.current.value(k)
                rec.action(d.agent, "param.propose", k, f"{frm} → {val}", dt=250)
                rec.emit(350, type="param", key=k, **{"from": frm, "to": val}, claimId=cid)
                run.overrides[k] = val
                changes[k] = val
    return changes


def confidence(run: Run) -> dict:
    """Epistemic confidence from things we can measure, not from vibes.

    - coverage:     sensor coverage of the zone (thin data widens the band)
    - sources:      share of cited rows that are verified (live pulls) vs demo
    - assumptions:  share of inputs the planner stated vs assumed
    - stability:    how much the debate moved the answer (round 1 vs final)
    - open:         unresolved [ASK] and rejected claims
    """
    sims = run.sims
    first, final = sims[1]["summary"], sims[max(sims)]["summary"]
    cov = {"good": 1.0, "thin": 0.6, "none": 0.3}.get(final["coverage"], 0.8)
    cited = {c["ledgerRef"] for c in run.claims.values() if c.get("ledgerRef") and c["status"] == "accepted"}
    rows = [ledger.get(r) for r in cited if ledger.get(r)]
    verified = sum(1 for r in rows if r.get("status") == "verified") / len(rows) if rows else 0.0
    params = run.scenario.params.values()
    stated = sum(1 for p in params if p.origin == "stated") / max(1, len(list(run.scenario.params.values())))
    mid0 = (first["deltaLo"] + first["deltaHi"]) / 2
    mid1 = (final["deltaLo"] + final["deltaHi"]) / 2
    moved = abs(mid1 - mid0) / mid0 if mid0 > 0.1 else 0.0
    asks = sum(1 for c in run.claims.values() if c["status"] == "ask")
    rejected = sum(1 for c in run.claims.values() if c["status"] == "rejected")
    score = 0.3 * cov + 0.25 * verified + 0.2 * stated + 0.25 * (1 - min(1.0, moved)) - 0.04 * asks - 0.02 * rejected
    score = max(0.0, min(1.0, score))
    grade = "High" if score >= 0.7 else "Medium" if score >= 0.45 else "Low"
    reasons = []
    if cov < 1:
        reasons.append("sensor coverage in the zone is thin")
    if verified < 0.5:
        reasons.append("most cited sources are demo rows, not verified pulls")
    if stated < 0.5:
        reasons.append("most inputs are assumptions, not stated by the planner")
    if moved > 0.35:
        reasons.append("the debate moved the estimate a lot: treat it as high variance")
    if asks:
        reasons.append(f"{asks} open question{'s' if asks > 1 else ''}")
    return {"score": round(score, 2), "grade": grade, "highVariance": moved > 0.35,
            "components": {"coverage": cov, "sources": round(verified, 2), "assumptions": round(stated, 2), "stability": round(1 - min(1.0, moved), 2), "openQuestions": asks, "rejected": rejected},
            "reasons": reasons}


def _brief(run: Run) -> str:
    sc, sim = run.current, run.sims[max(run.sims)]
    s = sim["summary"]
    acc = [c for c in run.claims.values() if c["status"] == "accepted"]
    asks = [c for c in run.claims.values() if c["status"] == "ask"]
    rej = [c for c in run.claims.values() if c["status"] == "rejected"]
    lines = [f"# {sc.title}", "", f"> {sc.text}", "",
             f"Under these assumptions, the estimated reduction is {s['deltaLo']:.0f}–{s['deltaHi']:.0f} AQI points "
             f"({s['pctLo']:.1f}–{s['pctHi']:.1f}%). This is not a forecast.", "", "## Findings (accepted claims only)"]
    lines += [f"- **{AGENTS[c['agent']]['name']}:** {c['text']}" for c in acc]
    if asks:
        lines += ["", "## Open questions"] + [f"- [ASK] {c['text']}" for c in asks]
    conf = confidence(run)
    lines += ["", f"## Confidence: {conf['grade']} ({conf['score']:.2f})" + (" · high variance" if conf["highVariance"] else "")] + [f"- {r}" for r in conf["reasons"]]
    lines += ["", "## Assumptions"] + [f"- {p.label}: {p.value}{p.unit or ''} ({p.origin})" for p in sc.params.values() if p.origin != "stated"]
    if rej:
        lines += ["", "## Excluded"] + [f"- ~~{c['text']}~~ — {c['reason']}" for c in rej]
    return "\n".join(lines) + "\n"


def _write(run: Run, name: str, data) -> None:
    d = RUNS / run.id
    d.mkdir(parents=True, exist_ok=True)
    p = d / name
    p.write_text(data if isinstance(data, str) else json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")


def execute(text: str, zone_id: str | None = None, overrides: dict | None = None, kind: str = "assessment",
            run_id: str | None = None, created_at: str | None = None, backend=None) -> Run:
    backend = backend or RuleBackend()
    sc = compile_policy(text, zone_id, overrides)
    rid = run_id or f"r-{fnv1a(sc.fingerprint + str(time.time()))[:6]}"
    sc.id = rid
    run = Run(rid, kind, created_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), sc)
    rec = Recorder(run)
    blocked = any(w.level == "block" for w in sc.warnings)

    # 1 · Scope
    rec.stage("scope", "start", 200)
    for p in sc.params.values():
        if p.ledgerRef:
            rec.action("compiler", "ledger.lookup", p.ledgerRef, p.label, dt=220)
    rec.message("compiler", "Parsed into parameters. Source [[param:vehicleClass]], area [[param:zone]], cut [[param:reductionPct]] of [[param:targetedShare]] in scope, for [[param:durationDays]].", focus=zone_focus(sc, (0, 0)))
    assumed = [p.label.lower() for p in sc.params.values() if p.origin != "stated"]
    if assumed:
        rec.message("compiler", f"Not stated, so marked as assumptions: {', '.join(assumed)}. None were guessed silently.", dt=1100)
    _write(run, "scenario.json", sc.to_json())
    rec.stage("scope", "done", 500)

    # 2 · Simulate
    rec.stage("simulate", "start", 250)
    _sim(run, rec)
    rec.message("simulator", "Round 1 complete · fingerprint [[fp]]. Zone mean [[sim:zoneBefore]] → [[sim:zoneAfterRange]] under these assumptions. The band widens where stations are sparse.", dt=900, focus=zone_focus(sc, (0, 0)))
    rec.stage("simulate", "done", 500)

    # 3 · Challenge + 4 · Verify (interleaved)
    rec.stage("challenge", "start", 250)
    rec.stage("verify", "start", 50)
    ctx = Context(run.current, simulate(run.current))
    drafts = [d for a in ORDER for d in backend.drafts(a, ctx)]
    changes = _debate(run, rec, drafts)
    _write(run, "objections.md", "\n".join(f"- {AGENTS[d.agent]['name']}: {d.text}" + (f" (changes {d.changes})" if d.changes else "") for d in drafts) + "\n")
    rec.stage("challenge", "done", 400)
    if changes and not blocked:
        _sim(run, rec)
        rec.message("simulator", "Round 2 with accepted objections · fingerprint [[fp]]. Zone mean now [[sim:zoneAfterRange]]. Spillover to neighbours [[sim:spillover]].", dt=900, focus=zone_focus(sc, (0, 0)))
    else:
        run.sims[2] = {**run.sims[1], "round": 2}
    _write(run, "claims.json", run.claims)
    rec.stage("verify", "done", 350)

    # 5 · Decide
    rec.stage("decide", "start", 250)
    rec.message("writer", "Brief drafted. Recommendation: do not proceed. The policy targets a near-empty fleet segment." if blocked
                else "Brief drafted from accepted claims only. Under these assumptions, the estimated reduction is [[sim:deltaRange]] AQI points ([[sim:pctRange]]). Rejected and unsourced claims are excluded.", dt=1200)
    _write(run, "brief.md", _brief(run))
    rec.stage("decide", "done", 600)
    rec.emit(300, type="complete")
    _write(run, "events.json", run.events)
    return run


# --------------------------------------------------------------------------- interjections

INTERJECT_RULES = [
    (r"(\d{1,3})\s?%\s*(compliance|enforcement)|compliance\s*(?:of|at|to|is|=)?\s*(\d{1,3})", "compliancePct"),
    (r"\b(camera|anpr|strict)", "compliancePct:85"),
    (r"\bwindy|wind\b", "weather:windy"),
    (r"\bcalm|inversion|still\b", "weather:calm"),
    (r"(\d+)\s*(month|week|day)s?", "durationDays"),
    (r"\b(all day|24 ?h|round the clock)\b", "hours:All day"),
    (r"\bnight\b", "hours:23:00 – 07:00"),
]


def interject(run: Run, text: str) -> list[dict]:
    """The planner challenges the council mid-run. Returns the new events."""
    rec = Recorder(run)
    start = len(run.events)
    rec.message("planner", text, dt=500)
    t = text.lower()
    change: tuple[str, float | str] | None = None
    for rx, target in INTERJECT_RULES:
        m = re.search(rx, t)
        if not m:
            continue
        if ":" in target:
            k, v = target.split(":", 1)
            change = (k, float(v) if v.replace(".", "").isdigit() else v)
        elif target == "compliancePct":
            num = next(g for g in m.groups() if g and g.isdigit())
            change = (target, float(min(100, int(num))))
        elif target == "durationDays":
            mult = {"month": 30, "week": 7, "day": 1}[m.group(2)]
            change = (target, float(int(m.group(1)) * mult))
        break

    if not change:
        rec.message("skeptic", "That question doesn't map to an input the simulator has. Rephrase it as a change to compliance, hours, duration or weather.", dt=1000)
        rec.emit(200, type="complete")
        return run.events[start:]

    k, v = change
    frm = run.current.value(k)
    cid = f"c{len(run.claims) + 1}"
    text_claim = f"Planner scenario: [[param:{k}]] changes. The skeptic keeps the original as the conservative case; the band shows both."
    run.claims[cid] = {"id": cid, "agent": "planner", "text": text_claim, "status": "pending", "scope": "city", "changes": {"key": k, "from": frm, "to": v}}
    rec.action("skeptic", "ledger.lookup", "L-024" if k == "weather" else "L-010", "checking the planner's assumption", dt=400)
    rec.message("skeptic", f"Noted. Changing {run.current.params[k].label.lower()} is an assumption, not evidence. I'll accept it as a scenario, not a finding.", dt=1100, claim_id=cid)
    rec.action("verifier", "verify", cid, "scenario change, no figure asserted", dt=300)
    run.claims[cid].update(status="accepted", reason="Scenario change requested by the planner; marked as an assumption.", rule="planner-scenario")
    rec.emit(700, type="verdict", claimId=cid, status="accepted", reason="Scenario change requested by the planner; marked as an assumption.", rule="planner-scenario")
    rec.action("planner", "param.propose", k, f"{frm} → {v}", dt=250)
    rec.emit(300, type="param", key=k, **{"from": frm, "to": v}, claimId=cid)
    run.overrides[k] = v
    _sim(run, rec)
    n = max(run.sims)
    rec.message("simulator", f"Round {n} with the planner's change · fingerprint [[fp]]. Zone mean now [[sim:zoneAfterRange]].", dt=900)
    rec.emit(300, type="complete")
    _write(run, "events.json", run.events)
    _write(run, "brief.md", _brief(run))
    return run.events[start:]
