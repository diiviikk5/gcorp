"""The council: roles, playbooks and the agent backend interface.

Agents never output numbers. They argue about assumptions and cite ledger rows
or simulator outputs as tokens: [[L-011]], [[sim:deltaRange]], [[param:compliancePct]].

`RuleBackend` is a deterministic, offline backend that drafts claims from
role playbooks. An LLM backend can implement the same `drafts()` signature
later (prompts live in council/roles/*.md and council/stages/*.md); nothing
else in the pipeline changes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

import yaml

from ..city import ZONE_BY_ID
from ..scenario import Scenario
from ..simulator import SimResult

ROLES_DIR = Path(__file__).parent / "roles"


def load_roles() -> dict[str, dict]:
    """Role contracts live in council/roles/*.md (YAML frontmatter + prose)."""
    out: dict[str, dict] = {}
    for f in sorted(ROLES_DIR.glob("*.md")):
        text = f.read_text(encoding="utf-8")
        _, fm, body = text.split("---", 2)
        meta = yaml.safe_load(fm)
        out[meta["id"]] = {
            "name": meta["name"], "role": meta["question"], "model": meta.get("backend", "rules"),
            "tools": meta.get("tools", []), "mayChange": meta.get("may_change", []), "contract": body.strip(),
        }
    return out


AGENTS = load_roles()


@dataclass
class Draft:
    agent: str
    text: str
    lookups: list[str] = field(default_factory=list)
    scope: str = "city"
    changes: dict[str, float | str] = field(default_factory=dict)
    focus: tuple[int, int] = (0, 0)  # offset from zone centre
    is_claim: bool = True


@dataclass
class Context:
    scenario: Scenario
    sim: SimResult

    @property
    def zone(self):
        return ZONE_BY_ID.get(self.scenario.zone_id)

    @property
    def where(self) -> str:
        return self.zone.name if self.zone else "Delhi"


class AgentBackend(Protocol):
    def drafts(self, agent: str, ctx: Context) -> list[Draft]: ...


VEHICLES = {"trucks", "cars", "autos", "twoWheelers", "buses"}


def school_ref(c: "Context") -> str:
    """Prefer the verified per-zone OSM count when `gcorp data pull` has run."""
    from .. import ledger
    rid = f"L-012-{c.scenario.zone_id}"
    return rid if ledger.get(rid) else "L-012"


class RuleBackend:
    """Deterministic playbooks. Each draft records the ledger rows it opened."""

    def drafts(self, agent: str, ctx: Context) -> list[Draft]:
        return getattr(self, f"_{agent}", lambda _c: [])(ctx)

    # -- source analyst: is the target big enough? ----------------------------
    def _apportionment(self, c: Context) -> list[Draft]:
        s, sm = c.scenario, c.sim.summary
        refs = ["L-001", "L-002"] if s.vehicle_class in VEHICLES else ["L-004"] if s.vehicle_class == "construction" else ["L-005"] if s.vehicle_class == "industry" else ["L-006"]
        cite = " ".join(f"[[{r}]]" for r in refs)
        out = []
        if sm.ceiling_pct < 3:
            out.append(Draft("apportionment", f"Low leverage. The targeted source is a small slice of local PM2.5 {cite}, so even full compliance tops out at [[sim:ceiling]]. Bigger sources should be compared first.", refs))
        else:
            out.append(Draft("apportionment", f"The targeted source is a material share of local PM2.5 {cite}. Ceiling at full compliance: [[sim:ceiling]]. Leverage is real; the debate should be about compliance and displacement.", refs))
        z = c.zone
        if z and z.character == "transit" and s.vehicle_class in VEHICLES:
            out.append(Draft("apportionment", f"{z.name} is a transit zone where vehicles weigh more than the city mean [[L-033]], so city-wide shares understate this lever here.", ["L-033"], scope="zone", focus=(1, 0)))
        return out

    # -- externalities: what the border can't stop -----------------------------
    def _externalities(self, c: Context) -> list[Draft]:
        s = c.scenario
        month = int(str(s.value("startDate"))[5:7]) if s.value("startDate") else 0
        regional = float(s.num("regionalPct", 25))
        from .. import ledger
        fires = ledger.get("L-034")
        fire_ref = " Fire counts upwind [[L-034]] confirm the season." if fires else ""
        if month in (10, 11, 12, 1):
            peak = max(regional, 40.0)
            return [Draft("externalities", "Stubble season. On a peak smoke day regional transport carries [[L-007]] of PM2.5, which this policy cannot touch. Testing the peak day, not the monthly mean [[L-032]]." + fire_ref
                          + " Expect the ceiling on local improvement to fall.", ["L-007", "L-032"] + (["L-034"] if fires else []), changes={"regionalPct": peak}, focus=(-4, -3))]
        return [Draft("externalities", "Outside stubble season regional transport is a minor share [[L-032]]; local levers keep most of their reach.", ["L-032"])]

    # -- engineer: how much do emissions change -------------------------------
    def _engineer(self, c: Context) -> list[Draft]:
        s = c.scenario
        cls = s.vehicle_class
        if any(w.ledgerRef == "L-008" for w in s.warnings):
            return [Draft("engineer", "This targets diesel autos, but Delhi's auto fleet is CNG [[L-008]]. The share in scope is effectively nil, so the estimated change is within noise.", ["L-008"])]
        if cls in VEHICLES:
            if cls == "cars":
                leak = Draft("engineer", "Restricted car trips don't disappear. Many shift to exempted two-wheelers and cabs [[L-017]]. Input to change: displaced activity.", ["L-017"], changes={"leakagePct": 25}, focus=(-3, 2))
            else:
                leak = Draft("engineer", "Barred trucks won't vanish. Through-traffic reroutes to the peripheral corridor; diversion after the expressway opened was [[L-011]]. Input to change: displaced activity.", ["L-011"], changes={"leakagePct": 30}, focus=(-3, 2))
            overreach = Draft("engineer", f"{'Cars' if cls == 'cars' else 'Trucks'} are the largest vehicle source in {c.where}, per the apportionment split [[L-002]].", ["L-002"], scope="zone", focus=(0, 0))
            out = [leak, overreach]
            if str(s.value("hours")).startswith("23"):
                out.append(Draft("engineer", "Night entry is when most trucks move [[L-015]], so a night ban covers the bulk of their activity; the diurnal profile [[L-023]] backs this.", ["L-015", "L-023"], focus=(1, 1)))
            return out
        if cls == "construction":
            return [
                Draft("engineer", "Only sites not already following dust rules are in scope [[L-019]]. Point sources keep the effect local; little spillover expected.", ["L-019"]),
                Draft("engineer", "Dust enforcement typically halves construction PM within weeks.", [], focus=(1, 0)),
            ]
        return [Draft("engineer", f"The apportionment share for this sector [[L-005]] bounds how much {c.where} can gain.", ["L-005"])]

    # -- epidemiologist: who breathes it --------------------------------------
    def _epidemiologist(self, c: Context) -> list[Draft]:
        if any(w.ledgerRef == "L-008" for w in c.scenario.warnings):
            return [Draft("epidemiologist", "Agreed: no exposure change to attribute. Any health claim here would be fabricated.", [])]
        night = str(c.scenario.value("hours")).startswith("23")
        return [
            Draft("epidemiologist", f"Exposure concentrates near arterials: the school count within reach of an arterial [[{school_ref(c)}]] puts children close to the corridor."
                  + (" Night-time entry [[L-015]] means the residual load lands on residents at home." if night else ""),
                  [school_ref(c)] + (["L-015"] if night else []), scope="zone" if school_ref(c) != "L-012" else "city", focus=(1, -2)),
            Draft("epidemiologist", f"This should prevent a meaningful number of asthma admissions in {c.where}.", ["L-022"], scope="zone"),
        ]

    # -- economist: who bears the cost ----------------------------------------
    def _economist(self, c: Context) -> list[Draft]:
        cls = c.scenario.vehicle_class
        if cls == "trucks":
            return [Draft("economist", "Cost falls on small operators: the share running small fleets [[L-014]] can't easily shift to compliant fleets. Enforcement needs cameras at entry points [[L-025]].", ["L-014", "L-025"], focus=(3, 3))]
        if cls == "cars":
            return [Draft("economist", "Rationing costs are front-loaded on enforcement and transit top-ups [[L-031]]; households with one car carry most of it.", ["L-031"])]
        if cls == "construction":
            return [Draft("economist", "Inspection capacity is the binding cost [[L-026]]; small builders bear compliance costs first.", ["L-026"])]
        return []

    # -- skeptic: the weakest assumption --------------------------------------
    def _skeptic(self, c: Context) -> list[Draft]:
        s = c.scenario
        if any(w.ledgerRef == "L-008" for w in s.warnings):
            return [Draft("skeptic", "Weakest assumption is that this policy does anything. In this corridor the load comes from goods vehicles [[L-009]] and road dust [[L-003]].", ["L-009", "L-003"], focus=(2, 1))]
        comp = float(s.num("compliancePct", 70))
        if s.vehicle_class in VEHICLES:
            new = max(40.0, comp - 15)
            return [Draft("skeptic", "Weakest assumption: compliance [[param:compliancePct]], borrowed from a car scheme [[L-010]]. Evidence that settles it: a fortnight of camera counts at the entry points. Meanwhile regional smoke [[L-007]] can swamp the local gain on peak days.",
                          ["L-010", "L-007"], changes={"compliancePct": new}, focus=(4, 0))]
        return [Draft("skeptic", "Weakest assumption: inspection capacity. Compliance [[param:compliancePct]] assumes inspectors reach every site [[L-019]]. Settle it with a month of the inspection roster.",
                      ["L-019"], changes={"compliancePct": max(40.0, comp - 10)})]


def zone_focus(sc: Scenario, offset: tuple[int, int]) -> list[int]:
    z = ZONE_BY_ID.get(sc.zone_id)
    cx, cz = (z.cx, z.cz) if z else (15, 15)
    return [max(0, min(29, cx + offset[0])), max(0, min(29, cz + offset[1]))]
