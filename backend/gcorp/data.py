"""Data pipeline: pull real figures, cache them, and promote ledger rows from
`demo` to `verified` with a real retrieval timestamp and query URL.

Sources (no key needed unless noted):
- Open-Meteo       boundary-layer height + wind for Delhi        -> L-024
- OpenStreetMap    schools / hospitals around each zone (Overpass) -> L-012, L-013 (per zone)
- OpenAQ v3        latest PM2.5 at Delhi stations (OPENAQ_API_KEY) -> station rows
Everything is cached under gcorp/data/cache so the engine runs offline after one pull.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import httpx

CACHE = Path(__file__).parent / "data" / "cache"
UA = {"User-Agent": "gcorp-hackathon/0.2 (air policy pre-check; contact via github.com/diiviikk5/gcorp)"}

# Real coordinates for each stylised zone (approximate area centres).
ZONE_GEO = {
    "narela": (28.853, 77.093), "rohini": (28.737, 77.115), "jahangirpuri": (28.726, 77.163), "shahdara": (28.673, 77.289),
    "wazirpur": (28.699, 77.165), "mundka": (28.682, 77.032), "punjabibagh": (28.668, 77.131), "ito": (28.628, 77.241),
    "anandvihar": (28.647, 77.316), "lodhi": (28.588, 77.222), "rkpuram": (28.563, 77.183), "dwarka": (28.590, 77.046), "okhla": (28.531, 77.271),
}


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _save(name: str, data) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / name).write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")


def load(name: str):
    try:
        return json.loads((CACHE / name).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _env_key(name: str) -> str | None:
    if os.environ.get(name):
        return os.environ[name]
    env = Path(__file__).resolve().parent.parent / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"')
    return None


def pull_weather() -> str:
    lat, lon = ZONE_GEO["anandvihar"]
    url = (f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
           "&hourly=boundary_layer_height,wind_speed_10m,wind_direction_10m&past_days=7&forecast_days=1&timezone=Asia%2FKolkata")
    d = httpx.get(url, timeout=20, headers=UA).json()
    h = d["hourly"]
    blh = [v for v in h["boundary_layer_height"] if v is not None]
    wind = [v for v in h["wind_speed_10m"] if v is not None]
    night = [b for t, b in zip(h["time"], h["boundary_layer_height"]) if b is not None and (t[11:13] >= "22" or t[11:13] <= "06")]
    mean_blh, mean_wind = sum(blh) / len(blh), sum(wind) / len(wind)
    regime = "calm" if mean_blh < 450 and mean_wind < 8 else "windy" if mean_wind > 14 else "average"
    row = {
        "id": "L-024", "label": "Mixing height and wind, Anand Vihar, last 7 days",
        "value": f"BLH mean {mean_blh:.0f} m (night {sum(night) / max(1, len(night)):.0f} m) · wind {mean_wind:.1f} km/h → {regime}",
        "source": "Open-Meteo forecast API (boundary_layer_height, wind_speed_10m)", "url": url, "retrievedAt": _now(),
        "scope": "Anand Vihar grid point, hourly", "status": "verified", "regime": regime,
    }
    _save("weather.json", {"row": row, "hourly": h})
    return f"{regime} · BLH {mean_blh:.0f} m · wind {mean_wind:.1f} km/h"


OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]


def _overpass(q: str) -> dict:
    last = None
    for url in OVERPASS:
        try:
            r = httpx.post(url, data={"data": q}, timeout=90, headers=UA)
            r.raise_for_status()
            return r.json()
        except httpx.HTTPError as e:
            last = e
    raise last  # type: ignore[misc]


def pull_osm() -> str:
    """One batched query: per zone, count schools then hospitals/clinics within 2 km."""
    parts = []
    for lat, lon in ZONE_GEO.values():
        parts.append(f'nwr(around:2000,{lat},{lon})["amenity"="school"];out count;')
        parts.append(f'nwr(around:2000,{lat},{lon})["amenity"~"^(hospital|clinic)$"];out count;')
    els = [e for e in _overpass("[out:json][timeout:80];" + "".join(parts))["elements"] if e.get("type") == "count"]
    counts = {zid: {"schools": int(els[2 * i]["tags"]["total"]), "hospitals": int(els[2 * i + 1]["tags"]["total"])} for i, zid in enumerate(ZONE_GEO)}
    _save("osm_counts.json", {"retrievedAt": _now(), "radius_m": 2000, "counts": counts})
    return f"{sum(c['schools'] for c in counts.values())} schools, {sum(c['hospitals'] for c in counts.values())} hospitals/clinics across {len(counts)} zones"


def pull_openaq() -> str:
    key = _env_key("OPENAQ_API_KEY")
    if not key:
        return "skipped: set OPENAQ_API_KEY in backend/.env (free key at explore.openaq.org)"
    lat, lon = 28.62, 77.21
    hdr = {**UA, "X-API-Key": key}
    locs = httpx.get("https://api.openaq.org/v3/locations", params={"coordinates": f"{lat},{lon}", "radius": 25000, "limit": 100, "parameters_id": 2}, headers=hdr, timeout=30).json()["results"]
    out = []
    for loc in locs:
        latest = httpx.get(f"https://api.openaq.org/v3/locations/{loc['id']}/latest", headers=hdr, timeout=30).json().get("results", [])
        pm = [r for r in latest if r.get("sensorsId") in {s["id"] for s in loc.get("sensors", []) if s.get("parameter", {}).get("name") == "pm25"}]
        if pm:
            out.append({"id": loc["id"], "name": loc["name"], "lat": loc["coordinates"]["latitude"], "lon": loc["coordinates"]["longitude"],
                        "pm25": pm[0]["value"], "at": pm[0]["datetime"]["utc"]})
        time.sleep(0.2)
    _save("openaq_latest.json", {"retrievedAt": _now(), "stations": out})
    return f"{len(out)} Delhi stations with a PM2.5 reading"


def pull(online: bool = True) -> dict[str, str]:
    report = {}
    for name, fn in (("weather", pull_weather), ("osm", pull_osm), ("openaq", pull_openaq)):
        if not online:
            report[name] = "cached" if load({"weather": "weather.json", "osm": "osm_counts.json", "openaq": "openaq_latest.json"}[name]) else "no cache"
            continue
        try:
            report[name] = fn()
        except Exception as e:  # noqa: BLE001 — a failed source must never break the engine
            report[name] = f"failed ({type(e).__name__}: {str(e)[:80]}); using cache/demo"
    return report


def verified_rows() -> list[dict]:
    """Ledger rows promoted to `verified` from cached pulls."""
    rows = []
    w = load("weather.json")
    if w:
        rows.append(w["row"])
    osm = load("osm_counts.json")
    if osm:
        for zid, c in osm["counts"].items():
            rows.append({"id": f"L-012-{zid}", "label": f"Schools within 2 km · {zid}", "value": str(c["schools"]), "unit": "count",
                         "source": "OpenStreetMap via Overpass (amenity=school)", "url": "https://overpass-api.de", "retrievedAt": osm["retrievedAt"],
                         "scope": f"{zid}, 2 km radius", "status": "verified", "scopeLevel": "zone"})
            rows.append({"id": f"L-013-{zid}", "label": f"Hospitals and clinics within 2 km · {zid}", "value": str(c["hospitals"]), "unit": "count",
                         "source": "OpenStreetMap via Overpass (amenity=hospital|clinic)", "url": "https://overpass-api.de", "retrievedAt": osm["retrievedAt"],
                         "scope": f"{zid}, 2 km radius", "status": "verified", "scopeLevel": "zone"})
    aq = load("openaq_latest.json")
    if aq:
        for s in aq["stations"]:
            rows.append({"id": f"L-AQ-{s['id']}", "label": f"PM2.5 · {s['name']}", "value": f"{s['pm25']:.0f}", "unit": "µg/m³",
                         "source": "OpenAQ v3 latest", "url": f"https://explore.openaq.org/locations/{s['id']}", "retrievedAt": s["at"],
                         "scope": f"Station {s['id']}", "status": "verified", "scopeLevel": "point"})
    return rows
