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

try:
    import httpx
except ImportError:  # cloud runtimes (Lambda, AgentCore) only read the cache
    httpx = None

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


OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]


def _overpass(q: str, rounds: int = 4) -> dict:
    """Try each mirror; on server overload back off and try again (20 s, 40 s, 80 s)."""
    last = None
    for attempt in range(rounds):
        for url in OVERPASS:
            try:
                r = httpx.post(url, data={"data": q}, timeout=150, headers=UA)
                r.raise_for_status()
                return r.json()
            except httpx.HTTPError as e:
                last = e
        if attempt < rounds - 1:
            time.sleep(20 * 2 ** attempt)
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


def _openaq_get(url: str, params: dict | None, key: str) -> dict:
    """GET with the X-API-Key header; honours 429 by waiting for the reset window."""
    hdr = {**UA, "X-API-Key": key}
    for attempt in range(5):
        r = httpx.get(url, params=params, headers=hdr, timeout=30)
        if r.status_code == 429:
            wait = int(r.headers.get("x-ratelimit-reset", "60") or 60)
            time.sleep(min(max(wait, 5), 70))
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError("OpenAQ rate limit not cleared after retries")


def pull_openaq() -> str:
    """Latest PM2.5 at Delhi stations. Stays inside OpenAQ's 60/min limit (one request per station, paced)."""
    key = _env_key("OPENAQ_API_KEY")
    if not key:
        return "skipped: set OPENAQ_API_KEY in backend/.env (free key at explore.openaq.org)"
    locs = _openaq_get("https://api.openaq.org/v3/locations",
                       {"coordinates": "28.61,77.21", "radius": 25000, "limit": 100, "parameters_id": 2}, key)["results"]
    out = []
    for loc in locs:
        pm_sensor = next((s for s in loc.get("sensors", []) if s.get("parameter", {}).get("name") == "pm25"), None)
        if not pm_sensor:
            continue
        latest = _openaq_get(f"https://api.openaq.org/v3/sensors/{pm_sensor['id']}/measurements", {"limit": 1}, key)
        ms = latest.get("results", [])
        if ms:
            at = ms[0]["period"]["datetimeTo"]["utc"]
            val = ms[0]["value"]
            age_h = (time.time() - time.mktime(time.strptime(at[:19], "%Y-%m-%dT%H:%M:%S")) + time.timezone) / 3600
            # Keep every plausible reading and record its age. Stale data is labelled, never hidden.
            if 0 < val < 999:
                out.append({"id": loc["id"], "name": loc["name"], "sensor": pm_sensor["id"],
                            "lat": loc["coordinates"]["latitude"], "lon": loc["coordinates"]["longitude"],
                            "pm25": val, "at": at, "ageHours": round(age_h, 1), "fresh": age_h <= 48})
        time.sleep(1.1)  # ~55 requests/minute, under the 60/min ceiling
    _save("openaq_latest.json", {"retrievedAt": _now(), "stations": out})
    fresh = sum(1 for x in out if x["fresh"])
    return f"{len(out)} Delhi stations with a PM2.5 reading, {fresh} fresh (≤48 h)"


def pull_firms() -> str:
    """Active-fire detections upwind of Delhi (Punjab + Haryana), last 7 days, VIIRS (NASA FIRMS)."""
    key = _env_key("FIRMS_MAP_KEY")
    if not key:
        return "skipped: set FIRMS_MAP_KEY in backend/.env (free at firms.modaps.eosdis.nasa.gov/api/map_key)"
    bbox = "73.8,29.5,77.6,32.6"  # west,south,east,north: Punjab and northern Haryana
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/VIIRS_SNPP_NRT/{bbox}/7"
    r = httpx.get(url, timeout=60, headers=UA)
    r.raise_for_status()
    rows = [l for l in r.text.strip().splitlines()[1:] if l]
    _save("firms.json", {"retrievedAt": _now(), "bbox": bbox, "days": 7, "fires": len(rows)})
    return f"{len(rows)} fire detections upwind in the last 7 days"


def pull(online: bool = True) -> dict[str, str]:
    report = {}
    for name, fn in (("weather", pull_weather), ("osm", pull_osm), ("openaq", pull_openaq), ("firms", pull_firms)):
        if not online:
            report[name] = "cached" if load({"weather": "weather.json", "osm": "osm_counts.json", "openaq": "openaq_latest.json", "firms": "firms.json"}[name]) else "no cache"
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
    fr = load("firms.json")
    if fr:
        rows.append({"id": "L-034", "label": "Active fires upwind (Punjab, Haryana), last 7 days", "value": str(fr["fires"]), "unit": "detections",
                     "source": "NASA FIRMS, VIIRS S-NPP near real time", "url": "https://firms.modaps.eosdis.nasa.gov", "retrievedAt": fr["retrievedAt"],
                     "scope": "Upwind region, 7 days", "status": "verified", "scopeLevel": "district"})
    aq = load("openaq_latest.json")
    if aq:
        for s in aq["stations"]:
            rows.append({"id": f"L-AQ-{s['id']}", "label": f"PM2.5 · {s['name']}", "value": f"{s['pm25']:.0f}", "unit": "µg/m³",
                         "source": "OpenAQ v3 latest", "url": f"https://explore.openaq.org/locations/{s['id']}", "retrievedAt": s["at"],
                         "scope": f"Station {s['id']}", "status": "verified", "scopeLevel": "point"})
    return rows


# --------------------------------------------------------------------------- real ward geometry

def _project(lat0: float, lon0: float):
    import math
    k = 111_320.0
    c = math.cos(math.radians(lat0))
    return lambda lat, lon: (round((lon - lon0) * k * c, 1), round(-(lat - lat0) * k, 1))  # x east, z south (metres)


def pull_ward(zone: str = "anandvihar", radius: int = 1100) -> str:
    """Building footprints (+ heights), main roads and water around a zone, in local metres."""
    lat0, lon0 = ZONE_GEO[zone]
    import math
    dlat = radius / 111_320.0
    dlon = radius / (111_320.0 * math.cos(math.radians(lat0)))
    bb = f"{lat0 - dlat},{lon0 - dlon},{lat0 + dlat},{lon0 + dlon}"
    els = []
    for sel in ('way["building"]', 'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"]', 'way["natural"="water"];way["leisure"="park"]'):
        parts = "".join(f"{x}({bb});" for x in sel.split(";"))
        els += _overpass(f"[out:json][timeout:120];({parts});out tags geom;")["elements"]
        time.sleep(1.5)
    proj = _project(lat0, lon0)
    seed = 0
    buildings, roads, green = [], [], []
    for e in els:
        geom = e.get("geometry")
        if not geom:
            continue
        pts = [proj(p["lat"], p["lon"]) for p in geom]
        t = e.get("tags", {})
        if "building" in t:
            if len(pts) < 4:
                continue
            h = None
            try:
                h = float(str(t.get("height", "")).split()[0]) if t.get("height") else None
            except ValueError:
                h = None
            if h is None and t.get("building:levels"):
                try:
                    h = float(t["building:levels"]) * 3.2
                except ValueError:
                    pass
            if h is None:  # deterministic plausible height by type
                seed = (seed * 1103515245 + 12345 + e["id"]) & 0x7FFFFFFF
                base = {"apartments": 18, "commercial": 14, "retail": 9, "industrial": 9, "warehouse": 8, "school": 10, "hospital": 16}.get(t["building"], 7)
                h = base + (seed % 7)
            buildings.append({"p": pts[:-1] if pts[0] == pts[-1] else pts, "h": round(h, 1), "t": t.get("building")})
        elif "highway" in t:
            w = {"motorway": 22, "trunk": 18, "primary": 14, "secondary": 11, "tertiary": 8}.get(t["highway"], 5)
            roads.append({"p": pts, "w": w, "n": t.get("name", "")})
        else:
            green.append({"p": pts[:-1] if pts[0] == pts[-1] else pts, "k": "water" if t.get("natural") == "water" else "park"})
    stations = [{"name": "Anand Vihar (CPCB)", "p": proj(28.6468, 77.3160)}] if zone == "anandvihar" else []
    out = {"zone": zone, "center": [lat0, lon0], "radius": radius, "retrievedAt": _now(), "source": "OpenStreetMap via Overpass",
           "buildings": buildings, "roads": roads, "green": green, "stations": stations}
    _save(f"ward_{zone}.json", out)
    return f"{len(buildings)} buildings, {len(roads)} roads, {len(green)} parks/water within {radius} m of {zone}"
