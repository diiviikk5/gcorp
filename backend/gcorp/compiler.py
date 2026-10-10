"""Policy compiler: constrained extraction, no LLM.

Every parameter is marked stated / assumed / unknown. Unknowns are flagged and
filled with an explicit default only so the simulator can run; the planner
confirms them. Port of web/src/sim/compiler.ts, plus weather.
"""

from __future__ import annotations

import re

from .city import ZONE_BY_ID, ZONES, zone_coverage
from .scenario import Param, Scenario, Warning

CLASS_LABEL = {
    "trucks": "Goods vehicles (trucks)",
    "autos": "Auto-rickshaws (3W)",
    "cars": "Private cars",
    "twoWheelers": "Two-wheelers",
    "buses": "Buses",
    "construction": "Construction dust",
    "industry": "Industrial units",
    "wasteBurning": "Open waste burning",
}

CLASS_PATTERNS = [
    ("autos", r"\b(autos?|auto-?rickshaws?|three-?wheelers?|3w)\b"),
    ("trucks", r"\b(trucks?|lorr(y|ies)|goods vehicles?|hgvs?|hdvs?|heavy vehicles?|freight)\b"),
    ("cars", r"\b(cars?|odd-?even|private vehicles?|four-?wheelers?)\b"),
    ("twoWheelers", r"\b(two-?wheelers?|bikes?|scooters?|motorcycles?|2w)\b"),
    ("buses", r"\b(bus|buses)\b"),
    ("construction", r"\b(construction|demolition|building sites?|dust)\b"),
    ("industry", r"\b(industr(y|ies|ial)|factor(y|ies)|boilers?|furnaces?)\b"),
    ("wasteBurning", r"\b(waste|garbage|landfill|trash|leaf) burning\b|\bburning (of )?(waste|garbage)\b"),
]

MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "six": 6, "twelve": 12}
UNIT_DAYS = {"day": 1, "week": 7, "month": 30, "year": 365}


def compile_policy(text: str, zone_id: str | None = None, overrides: dict | None = None) -> Scenario:
    t = text.lower()
    warnings: list[Warning] = []

    cls = next((c for c, rx in CLASS_PATTERNS if re.search(rx, t)), None)
    if cls is None:
        warnings.append(Warning("block", "Couldn't tell which emission source this policy targets. Name a vehicle class or sector (e.g. trucks, construction dust)."))
        cls = "trucks"
    odd_even = bool(re.search(r"odd-?even", t))

    fm = re.search(r"\b(diesel|petrol|cng|bs-?\s?(iii|iv|3|4)( and older)?|non-?bs-?vi|old(er)?)\b", t)
    fuel = re.sub(r"\s+", " ", fm.group(0)) if fm else None

    zone, zone_origin = (zone_id or ""), ("stated" if zone_id else "unknown")
    if re.search(r"\b(city-?wide|all of delhi|across delhi|whole city|entire city|delhi-?wide)\b", t) or (odd_even and not zone_id):
        zone, zone_origin = "all", "stated"
    else:
        named = next((z for z in ZONES if z.name.lower() in t or z.id in t), None)
        if named:
            zone, zone_origin = named.id, "stated"
    if not zone:
        zone = "anandvihar"
        warnings.append(Warning("warn", "No area stated. Pick a zone before running."))

    reduction, red_origin = 100.0, "stated"
    pct = re.search(r"(\d{1,3})\s?%", t)
    if re.search(r"\bban(ned|s)?\b|\bprohibit|\bbar(red)?\b|\bodd-?even\b|\bshut\b", t):
        reduction = 100
    elif pct and re.search(r"(cut|reduc|lower|curb|limit)", t):
        reduction = min(100, int(pct.group(1)))
    elif re.search(r"(enforce|enforcement|crack ?down|inspect)", t):
        reduction = 100
    else:
        reduction, red_origin = 50, "unknown"
        warnings.append(Warning("warn", "Strength of the restriction isn't stated. Assumed a 50% cut in activity."))

    targeted, tgt_origin, tgt_ref, tgt_note = 100.0, "assumed", None, "Whole source class is in scope."
    if cls == "trucks" and (fuel is None or "diesel" in fuel):
        targeted, tgt_ref, tgt_note = 94, "L-009", "Diesel share of goods vehicles at entry points."
    if cls == "autos" and fuel and "diesel" in fuel:
        targeted, tgt_ref, tgt_note = 1, "L-008", "Delhi autos run on CNG."
        warnings.append(Warning("block", "Delhi's auto fleet is already CNG. A diesel-auto ban targets almost no emissions.", "L-008"))
    if odd_even:
        targeted, tgt_ref, tgt_note, tgt_origin = 50 * 0.65, "L-016", "Half of plates on any day, minus exempted trips (L-017).", "stated"
    if cls == "construction":
        targeted, tgt_ref, tgt_note = 45, "L-019", "Sites not already following dust-control rules."

    compliance, comp_origin = 70.0, "assumed"
    cm = re.search(r"(\d{1,3})\s?% (compliance|enforcement)", t)
    if cm:
        compliance, comp_origin = float(cm.group(1)), "stated"
    elif re.search(r"strict(ly)? enforc|camera|anpr", t):
        compliance = 85

    duration = None
    dm = re.search(r"(\d+|one|two|three|four|six|twelve)\s*(day|week|month|year)s?", t)
    if dm:
        nn = int(dm.group(1)) if dm.group(1).isdigit() else WORDS[dm.group(1)]
        duration = nn * UNIT_DAYS[dm.group(2)]
    elif "fortnight" in t:
        duration = 14
    dur_origin = "stated" if duration else "unknown"
    if not duration:
        duration = 90
        warnings.append(Warning("warn", "Duration not stated. Assumed 90 days; confirm before running."))

    start, start_origin = "2026-11-01", "assumed"
    mon = next((i for i, m in enumerate(MONTHS) if re.search(rf"\b(from|in|starting|start|beginning)\s+({m}|{m[:3]})\b", t)), -1)
    if mon >= 0:
        start, start_origin = f"{2026 if mon >= 9 else 2027}-{mon + 1:02d}-01", "stated"
        yr = re.search(r"\b(20\d\d)\b", t)
        if yr:
            start = f"{yr.group(1)}-{mon + 1:02d}-01"
    if int(start[5:7]) in (10, 11):
        warnings.append(Warning("info", "Starts in stubble-burning season. Regional smoke can swamp local gains on peak days.", "L-007"))

    hours, hours_origin = "All day", "assumed"
    if "night" in t:
        hours, hours_origin = "23:00 – 07:00", "stated"
    elif re.search(r"day-?time|daytime|peak hours", t):
        hours, hours_origin = "07:00 – 23:00", "stated"

    weather, weather_origin = "average", "assumed"
    from .data import load as _load_cache
    _w = _load_cache("weather.json")
    if _w:
        weather = _w["row"].get("regime", "average")  # last week's measured regime (L-024), still an assumption
    if re.search(r"\b(calm|still|inversion|smog episode)\b", t):
        weather, weather_origin = "calm", "stated"
    elif re.search(r"\b(windy|breezy|strong wind)\b", t):
        weather, weather_origin = "windy", "stated"

    if zone != "all":
        cov = zone_coverage(zone)
        if cov != "good":
            warnings.append(Warning("warn", "No usable AQI station in this zone. The range will be very wide." if cov == "none" else "Sensor coverage in this zone is thin. Expect a wider range."))

    params = {
        "vehicleClass": Param("vehicleClass", "Source", CLASS_LABEL[cls], "stated"),
        "fuelFilter": Param("fuelFilter", "Fuel / age filter", fuel or "Any", "stated" if fuel else "assumed"),
        "zone": Param("zone", "Area", "All of Delhi" if zone == "all" else ZONE_BY_ID[zone].name, zone_origin),
        "reductionPct": Param("reductionPct", "Activity cut", reduction, red_origin, unit="%"),
        "targetedShare": Param("targetedShare", "Share of source in scope", round(targeted, 1), tgt_origin, unit="%", note=tgt_note, ledgerRef=tgt_ref),
        "compliancePct": Param("compliancePct", "Compliance", compliance, comp_origin, unit="%",
                               ledgerRef="L-010" if comp_origin == "assumed" else None,
                               note="Default from the last city-wide restriction." if comp_origin == "assumed" else None),
        "leakagePct": Param("leakagePct", "Displaced activity", 0, "assumed", unit="%", note="Not modelled unless challenged."),
        "durationDays": Param("durationDays", "Duration", duration, dur_origin, unit="days"),
        "startDate": Param("startDate", "Start", start, start_origin),
        "hours": Param("hours", "Hours", hours, hours_origin, ledgerRef="L-015" if hours_origin == "stated" and hours.startswith("23") else None),
        "weather": Param("weather", "Weather", weather, weather_origin, ledgerRef="L-024", note="Mixing regime used by the simulator."),
    }
    for k, v in (overrides or {}).items():
        if k in params:
            p = params[k]
            params[k] = Param(p.key, p.label, v, "stated", p.unit, "Confirmed by planner.", p.ledgerRef)

    return Scenario(text=text, title=_title(cls, fuel, zone, params, odd_even, hours if hours_origin == "stated" else None),
                    vehicle_class=cls, zone_id=zone, params=params, warnings=warnings)


def _title(cls: str, fuel: str | None, zone: str, params: dict[str, Param], odd_even: bool, hours: str | None) -> str:
    where = "Delhi" if zone == "all" else ZONE_BY_ID[zone].name
    days = params["durationDays"].value
    span = f"{round(days / 30)} mo" if days >= 60 else f"{int(days)} d"
    if odd_even:
        return f"Odd-even car rationing · {where} · {span}"
    if cls == "construction":
        what = "Construction dust enforcement"
    elif cls == "industry":
        what = "Industrial curbs"
    elif cls == "wasteBurning":
        what = "Waste-burning crackdown"
    else:
        tod = ("night-time " if hours.startswith("23") else "daytime ") if hours else ""
        what = f"{tod}{fuel + ' ' if fuel else ''}{CLASS_LABEL[cls].split(' (')[0].lower()} ban"
    return f"{what[0].upper() + what[1:]} · {where} · {span}"


EXAMPLES = [
    ("Ban diesel trucks from entering Anand Vihar at night for six months starting November", "Flagship"),
    ("Enforce construction dust rules across Okhla for 3 months", "Sector"),
    ("Run odd-even for private cars across Delhi for 15 days in January 2016", "Replay"),
    ("Ban diesel autos in ITO for six months", "Gotcha"),
]
