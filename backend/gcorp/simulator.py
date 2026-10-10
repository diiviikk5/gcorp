"""Deterministic grid simulator. NOT an agent: same inputs, same output.

Estimates direction and rough magnitude only, always as a range. Port of
web/src/sim/simulator.ts extended with weather, time of day, and exposure
near schools. Every coefficient is a ledger reference.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .city import ZONE_BY_ID, get_city, uncertainty_field, zone_coverage
from .rng import clamp, mulberry32
from .scenario import Scenario

# Fraction of ambient PM2.5 attributable to each controllable source (winter).
SECTOR_SHARE: dict[str, tuple[float, list[str]]] = {
    "trucks": (0.2 * 0.42, ["L-001", "L-002"]),
    "twoWheelers": (0.2 * 0.28, ["L-001", "L-002"]),
    "cars": (0.2 * 0.18, ["L-001", "L-002"]),
    "buses": (0.2 * 0.07, ["L-001", "L-002"]),
    "autos": (0.2 * 0.05, ["L-001", "L-002"]),
    "construction": (0.07, ["L-004"]),
    "industry": (0.11, ["L-005"]),
    "wasteBurning": (0.08, ["L-006"]),
}
SHARE_SPREAD = 0.3

# Regional / transboundary share of PM2.5 by month (L-032). The apportionment
# shares above were measured in a winter averaging ~25% regional; local levers
# scale with the local remainder.
REGIONAL_BY_MONTH = {1: 26, 2: 20, 3: 14, 4: 10, 5: 10, 6: 8, 7: 6, 8: 6, 9: 10, 10: 25, 11: 32, 12: 28}
REGIONAL_REFERENCE = 25.0


def regional_default(start: str | None) -> float:
    try:
        return float(REGIONAL_BY_MONTH[int(str(start)[5:7])])
    except (ValueError, KeyError, TypeError):
        return REGIONAL_REFERENCE


# Share of each source's daily activity inside a time window (L-015, L-023).
NIGHT_SHARE = {"trucks": 0.78, "cars": 0.12, "twoWheelers": 0.08, "buses": 0.15, "autos": 0.1}

# Weather regimes (L-024): how strongly local emissions translate into local
# AQI, and how far displaced load travels.
WEATHER = {
    "calm": {"local": 1.25, "spill_decay": 1.2, "label": "Calm winter night (low mixing height)"},
    "average": {"local": 1.0, "spill_decay": 1.6, "label": "Typical winter day"},
    "windy": {"local": 0.7, "spill_decay": 2.6, "label": "Windy day (strong dispersion)"},
}

# Diurnal activity (fraction of daily traffic per hour) and mixing (lower = pollution stays).
DIURNAL_TRAFFIC = [0.02, 0.015, 0.012, 0.012, 0.015, 0.025, 0.04, 0.06, 0.07, 0.065, 0.055, 0.05,
                   0.05, 0.05, 0.05, 0.055, 0.06, 0.07, 0.07, 0.06, 0.045, 0.035, 0.03, 0.025]
MIXING = [0.55, 0.5, 0.48, 0.47, 0.48, 0.52, 0.6, 0.72, 0.85, 0.95, 1.05, 1.12,
          1.18, 1.2, 1.18, 1.1, 0.98, 0.85, 0.75, 0.68, 0.63, 0.6, 0.58, 0.56]


@dataclass
class SimSummary:
    zone_before: float
    zone_after_lo: float
    zone_after_hi: float
    delta_lo: float
    delta_hi: float
    pct_lo: float
    pct_hi: float
    exposure_lo: float
    exposure_hi: float
    spillover: float
    coverage: str
    band_width: float
    school_cells: int
    child_hours_lo: float
    child_hours_hi: float
    hourly: list[float] = field(default_factory=list)  # mid AQI reduction by hour, zone mean
    ceiling_pct: float = 0.0  # max achievable % at full compliance, no leakage
    regional_pct: float = 0.0


@dataclass
class SimResult:
    round: int
    fingerprint: str
    inputs: dict
    before: list[float]
    after_lo: list[float]
    after_hi: list[float]
    uncertainty: list[float]
    summary: SimSummary

    def to_json(self, with_grids: bool = True) -> dict:
        s = self.summary
        out = {
            "round": self.round,
            "fingerprint": self.fingerprint,
            "inputs": self.inputs,
            "summary": {
                "zoneBefore": s.zone_before, "zoneAfterLo": s.zone_after_lo, "zoneAfterHi": s.zone_after_hi,
                "deltaLo": s.delta_lo, "deltaHi": s.delta_hi, "pctLo": s.pct_lo, "pctHi": s.pct_hi,
                "exposureLo": s.exposure_lo, "exposureHi": s.exposure_hi, "spillover": s.spillover,
                "coverage": s.coverage, "bandWidth": s.band_width, "schoolCells": s.school_cells,
                "childHoursLo": s.child_hours_lo, "childHoursHi": s.child_hours_hi, "hourly": s.hourly,
                "ceilingPct": s.ceiling_pct, "regionalPct": s.regional_pct,
            },
        }
        if with_grids:
            r = lambda a: [round(v, 2) for v in a]  # noqa: E731
            out.update(before=r(self.before), afterLo=r(self.after_lo), afterHi=r(self.after_hi), uncertainty=r(self.uncertainty))
        return out


def school_cells(zone_id: str | None = None) -> set[int]:
    """Deterministically place each zone's schools on residential cells (L-012 counts)."""
    city, _, _ = get_city()
    rnd = mulberry32(2024)
    out: set[int] = set()
    for zn in city.zones:
        homes = [c for c in city.cells if c.zone == zn.id and c.kind == "building"]
        k = max(1, round(zn.schools / 12))  # one cell ~ a cluster of schools
        for _ in range(min(k, len(homes))):
            c = homes[int(rnd() * len(homes))]
            if zone_id in (None, "all") or c.zone == zone_id:
                out.add(city.idx(c.x, c.z))
    return out


def simulate(sc: Scenario, round_: int = 1, extra_sensors: list[tuple[int, int]] | None = None) -> SimResult:
    city, base, unc0 = get_city()
    unc = uncertainty_field(city, extra_sensors) if extra_sensors else unc0
    n = city.size

    cls = sc.vehicle_class
    share, _refs = SECTOR_SHARE[cls]
    targeted = sc.num("targetedShare", 100) / 100
    reduction = sc.num("reductionPct", 100) / 100
    compliance = sc.num("compliancePct", 70) / 100
    leakage = sc.num("leakagePct", 0) / 100
    days = sc.num("durationDays", 30)
    weather = WEATHER.get(str(sc.value("weather") or "average"), WEATHER["average"])
    hours = str(sc.value("hours") or "All day")
    is_point = cls in ("construction", "industry", "wasteBurning")
    all_city = sc.zone_id == "all"

    # Time window: what fraction of the source's activity the policy covers.
    if hours.startswith("23") and cls in NIGHT_SHARE:
        window = NIGHT_SHARE[cls] * 1.15  # night emissions linger under a low mixing layer
        active_hours = set(range(23, 24)) | set(range(0, 7))
    elif hours.startswith("07") and cls in NIGHT_SHARE:
        window = 1 - NIGHT_SHARE[cls]
        active_hours = set(range(7, 23))
    else:
        window = 1.0
        active_hours = set(range(24))
    window = min(1.0, window)

    in_zone = (lambda z: True) if all_city else (lambda z: z == sc.zone_id)
    zone_list = [c for c in city.cells if in_zone(c.zone)]
    dist = [99.0] * (n * n)
    if not all_city:
        for c in city.cells:
            i = city.idx(c.x, c.z)
            if in_zone(c.zone):
                dist[i] = 0
                continue
            dist[i] = min(abs(zc.x - c.x) + abs(zc.z - c.z) for zc in zone_list)

    regional = sc.num("regionalPct", regional_default(sc.value("startDate"))) / 100
    local_scale = (1 - regional) / (1 - REGIONAL_REFERENCE / 100)
    core = share * targeted * reduction * compliance * window * weather["local"] * local_scale
    # Ceiling: the most this lever could remove even at full compliance and no displacement.
    ceiling_pct = share * targeted * window * weather["local"] * local_scale * 100
    after_lo = [0.0] * (n * n)
    after_hi = [0.0] * (n * n)
    zb = zlo = zhi = zn = exp_lo = exp_hi = spill = band = 0.0
    spill_n = 0
    schools = school_cells(sc.zone_id)
    ch_lo = ch_hi = 0.0
    n_school = 0

    for c in city.cells:
        i = city.idx(c.x, c.z)
        b, u = base[i], unc[i]
        effect = 0.0
        if in_zone(c.zone):
            if is_point:
                w = (2.2 if c.kind == "industrial" else 0.55) if cls == "industry" else \
                    (1.2 if c.kind in ("building", "open") else 0.6) if cls == "construction" else 1.0
            else:
                w = 0.45 + 1.1 * c.road_weight
            effect = core * w * (1 - leakage)
        elif not all_city and leakage > 0 and not is_point:
            d = dist[i]
            if d <= 6:
                # Winter winds are north-westerly: displaced load drifts south-east (L-024).
                zc = ZONE_BY_ID[sc.zone_id]
                downwind = 1 + 0.25 * clamp(((c.x - zc.cx) + (c.z - zc.cz)) / 6, -1, 1)
                effect = -core * leakage * (0.4 + c.road_weight) * math.exp(-(d - 1) / weather["spill_decay"]) * 0.9 * downwind

        d_lo = b * effect * (1 - SHARE_SPREAD) * 0.85
        d_hi = b * effect * (1 + SHARE_SPREAD) * 1.15
        pad = u * abs(b * effect) * 0.35 + u * 1.5
        after_lo[i] = clamp(b - max(d_lo, d_hi) - pad, 20, 500)
        after_hi[i] = clamp(b - min(d_lo, d_hi) + pad, 20, 500)

        if in_zone(c.zone):
            zb += b; zlo += after_lo[i]; zhi += after_hi[i]; zn += 1
            exp_lo += c.population * max(0, b - after_hi[i])
            exp_hi += c.population * max(0, b - after_lo[i])
            band += after_hi[i] - after_lo[i]
            if i in schools:
                n_school += 1
                # ~600 children per cluster, 6 school hours a day (L-012)
                ch_lo += max(0, b - after_hi[i]) * 600 * 6 * days
                ch_hi += max(0, b - after_lo[i]) * 600 * 6 * days
        elif not all_city and dist[i] <= 4:
            spill += b - (after_lo[i] + after_hi[i]) / 2
            spill_n += 1

    zn = max(1.0, zn)
    zone_before, zone_lo, zone_hi = zb / zn, zlo / zn, zhi / zn
    delta_lo = max(0.0, zone_before - zone_hi)
    delta_hi = max(0.0, zone_before - zone_lo)
    mid = (delta_lo + delta_hi) / 2

    # Hourly profile of the mid reduction: where the window applies, scaled by
    # activity and inversely by mixing; elsewhere ~0. Normalised to the daily mean.
    raw = [(DIURNAL_TRAFFIC[h] / MIXING[h] if h in active_hours else 0.0) for h in range(24)]
    norm = sum(raw) / 24 or 1
    hourly = [round(mid * r / norm, 2) for r in raw] if not is_point else [round(mid * (1.3 if 8 <= h <= 18 else 0.7), 2) for h in range(24)]

    inputs = {
        "class": cls, "zone": sc.zone_id, "targetedShare": targeted, "reductionPct": reduction,
        "compliancePct": compliance, "leakagePct": leakage, "durationDays": days,
        "window": round(window, 3), "weather": weather["label"], "sectorShare": share, "regionalPct": regional * 100,
    }
    return SimResult(
        round=round_,
        fingerprint=sc.fingerprint,
        inputs=inputs,
        before=base,
        after_lo=after_lo,
        after_hi=after_hi,
        uncertainty=unc,
        summary=SimSummary(
            zone_before=zone_before, zone_after_lo=zone_lo, zone_after_hi=zone_hi,
            delta_lo=delta_lo, delta_hi=delta_hi,
            pct_lo=delta_lo / zone_before * 100, pct_hi=delta_hi / zone_before * 100,
            exposure_lo=exp_lo * days / 100, exposure_hi=exp_hi * days / 100,
            spillover=spill / spill_n if spill_n else 0.0,
            coverage="good" if all_city else zone_coverage(sc.zone_id, unc),
            band_width=band / zn, school_cells=n_school,
            child_hours_lo=ch_lo / 1e6, child_hours_hi=ch_hi / 1e6, hourly=hourly,
            ceiling_pct=ceiling_pct, regional_pct=regional * 100,
        ),
    )
