"""Three engines built on the same simulator.

- optimise():   goal -> ranked policy portfolios (reverse the question)
- track_record(): replay past Delhi policies, score predicted vs observed
- sensor_advice(): where one more sensor most narrows the decision band
"""

from __future__ import annotations

import itertools

from . import ledger
from .city import ZONE_BY_ID, get_city, zone_cells
from .compiler import compile_policy
from .simulator import simulate

# Candidate levers. Cost per month in ₹ crore, each tied to a ledger row.
LEVERS = [
    {"id": "truck-night", "group": "trucks", "label": "Night ban on diesel trucks", "text": "Ban diesel trucks from entering {zone} at night for {months} months", "cost": 0.6 * 4 / 12, "costRef": "L-025", "changes": {"leakagePct": 30, "compliancePct": 55}},
    {"id": "truck-all", "group": "trucks", "label": "All-day ban on diesel trucks", "text": "Ban diesel trucks from entering {zone} for {months} months", "cost": 0.6 * 6 / 12, "costRef": "L-025", "changes": {"leakagePct": 30, "compliancePct": 55}},
    {"id": "construction", "label": "Construction dust enforcement", "text": "Enforce construction dust rules across {zone} for {months} months", "cost": 0.2 / 3, "costRef": "L-026", "changes": {"compliancePct": 60}},
    {"id": "industry", "label": "Industrial emission curbs", "text": "Cut industrial emissions in {zone} by 30% for {months} months", "cost": 0.5, "costRef": "L-026", "changes": {"compliancePct": 60}},
    {"id": "waste", "label": "Open waste-burning crackdown", "text": "Enforce a ban on waste burning in {zone} for {months} months", "cost": 0.15, "costRef": "L-026", "changes": {"compliancePct": 50}},
    {"id": "cars", "label": "Odd-even for private cars", "text": "Run odd-even for private cars in {zone} for {months} months", "cost": 4 * 2, "costRef": "L-031", "changes": {"leakagePct": 25, "compliancePct": 55}},
]


def _eval_lever(lever: dict, zone: str, months: int) -> dict:
    name = ZONE_BY_ID[zone].name if zone != "all" else "Delhi"
    sc = compile_policy(lever["text"].format(zone=name, months=months), zone)
    sc = sc.with_changes(lever["changes"])
    s = simulate(sc).summary
    return {
        "id": lever["id"], "group": lever.get("group", lever["id"]), "label": lever["label"], "policy": sc.text, "costPerMonth": lever["cost"], "costRef": lever["costRef"],
        "cost": lever["cost"] * months, "deltaLo": s.delta_lo, "deltaHi": s.delta_hi,
        "childHoursLo": s.child_hours_lo, "childHoursHi": s.child_hours_hi, "spillover": s.spillover,
    }


def optimise(zone: str, target: float, budget: float, months: int = 3) -> dict:
    """Search lever combinations; keep those under budget, rank by how surely they hit the target.

    Effects are combined additively on the conservative and optimistic ends
    (an approximation the brief states openly).
    """
    evals = [_eval_lever(l, zone, months) for l in LEVERS]
    evals = [e for e in evals if e["deltaHi"] > 0.3]
    portfolios = []
    for k in (1, 2, 3):
        for combo in itertools.combinations(evals, k):
            if len({e["group"] for e in combo}) < len(combo):
                continue  # mutually exclusive levers
            cost = sum(e["cost"] for e in combo)
            if cost > budget:
                continue
            lo, hi = sum(e["deltaLo"] for e in combo), sum(e["deltaHi"] for e in combo)
            # chance the target is met, assuming a uniform spread inside the band
            p = 1.0 if lo >= target else 0.0 if hi < target else (hi - target) / (hi - lo)
            portfolios.append({
                "levers": [e["id"] for e in combo], "labels": [e["label"] for e in combo], "cost": round(cost, 2),
                "deltaLo": lo, "deltaHi": hi, "pTarget": round(p, 2),
                "childHoursLo": sum(e["childHoursLo"] for e in combo), "childHoursHi": sum(e["childHoursHi"] for e in combo),
            })
    portfolios.sort(key=lambda x: (-x["pTarget"], x["cost"], -x["deltaHi"]))
    best = portfolios[0] if portfolios else None
    note = None
    if not portfolios:
        note = "Nothing fits the budget. Raise the budget or lower the target."
    elif best and best["pTarget"] == 0:
        note = "No combination reliably meets the target. The honest answer is a smaller goal or a regional measure."
    return {"zone": zone, "target": target, "budget": budget, "months": months, "levers": evals, "portfolios": portfolios[:8], "note": note}


# Past Delhi policies with observed outcomes (ledger rows; demo values).
REPLAYS = [
    {"id": "oddeven-2016-jan", "name": "Odd-even, Jan 1–15 2016", "text": "Run odd-even for private cars across Delhi for 15 days in January 2016", "zone": None, "observedRef": "L-018", "observed": [1, 3], "changes": {"leakagePct": 25, "compliancePct": 55}},
    {"id": "oddeven-2019-nov", "name": "Odd-even, Nov 4–15 2019", "text": "Run odd-even for private cars across Delhi for 12 days in November 2019", "zone": None, "observedRef": "L-028", "observed": [1, 4], "changes": {"leakagePct": 25, "compliancePct": 60}},
    {"id": "grap-construction-2021", "name": "Construction ban, GRAP III, Nov 2021", "text": "Enforce construction dust rules across Delhi for 2 weeks in November 2021", "zone": None, "observedRef": "L-029", "observed": [2, 6], "changes": {"compliancePct": 75}},
    {"id": "truck-curbs-2023", "name": "Heavy-vehicle entry curbs, east Delhi, Nov 2023", "text": "Ban diesel trucks from entering Anand Vihar for 3 weeks in November 2023", "zone": "anandvihar", "observedRef": "L-030", "observed": [3, 9], "changes": {"leakagePct": 30, "compliancePct": 65}},
]


def track_record() -> dict:
    """Score raw predictions, then a leave-one-out calibrated version.

    Calibration (the brief's Reflect stage): for each case, learn a bias factor
    for its policy class from the *other* replays only, then predict the held-out
    case. No case ever sees its own observed value.
    """
    raw = []
    for r in REPLAYS:
        sc = compile_policy(r["text"], r["zone"]).with_changes(r["changes"])
        s = simulate(sc).summary
        raw.append((r, sc.vehicle_class, s.pct_lo, s.pct_hi))

    def hit(pl: float, ph: float, ol: float, oh: float) -> bool:
        return not (ph < ol or pl > oh)

    out = []
    for r, cls, pl, ph in raw:
        lo, hi = r["observed"]
        others = [(o, c, a, b) for o, c, a, b in raw if o is not r and c == cls]
        factors = [((o["observed"][0] + o["observed"][1]) / 2) / max(1e-6, (a + b) / 2) for o, _, a, b in others]
        f = sum(factors) / len(factors) if factors else 1.0
        cl, ch = pl * f, ph * f
        out.append({"id": r["id"], "name": r["name"], "policy": r["text"], "class": cls,
                    "predicted": [pl, ph], "calibrated": [cl, ch], "factor": round(f, 2), "calibratedFrom": [o["id"] for o, *_ in others],
                    "observed": [lo, hi], "observedRef": r["observedRef"],
                    "hit": hit(pl, ph, lo, hi), "hitCalibrated": hit(cl, ch, lo, hi)})
    n = len(out)
    hits = sum(x["hit"] for x in out)
    hits_c = sum(x["hitCalibrated"] for x in out)
    return {"cases": out, "total": n, "hits": hits, "hitsCalibrated": hits_c,
            "score": round(hits / n, 2), "scoreCalibrated": round(hits_c / n, 2),
            "note": "A hit means the predicted range overlaps the observed range. Calibration is leave-one-out by policy class. Observed values are demo ledger rows until replaced with published evaluations."}


def sensor_advice(run_text: str, zone: str, top: int = 5) -> dict:
    """Value of information: which single new sensor narrows this decision's band the most."""
    city, _, _ = get_city()
    sc = compile_policy(run_text, zone)
    base = simulate(sc).summary.band_width
    cands = [c for c in zone_cells(zone) if c.kind in ("building", "open", "park")] if zone != "all" else []
    # evaluate every other candidate to keep it fast (~25 ms per sim)
    results = []
    for c in cands[::2]:
        bw = simulate(sc, extra_sensors=[(c.x, c.z)]).summary.band_width
        results.append({"x": c.x, "z": c.z, "bandWidth": bw, "reduction": max(0.0, (base - bw) / base) if base else 0})
    results.sort(key=lambda r: -r["reduction"])
    cost = ledger.get("L-027")
    return {"zone": zone, "bandWidth": base, "candidates": results[:top], "unitCost": cost["value"] if cost else None, "unitCostRef": "L-027"}
