"""Hourly ingest (Lambda, run by Step Functions on an EventBridge Scheduler tick).

1. Modelled PM2.5 for every zone from Open-Meteo's air-quality API (CAMS global, coarse ~40 km grid, no key).
2. Measured PM2.5 from OpenAQ where a station near the zone has a reading in the last 3 hours
   (key read from SSM Parameter Store, never from code).
3. 24h mean -> CPCB AQI, written to DynamoDB and CloudWatch (namespace Gcorp).

Returns {"zones": [...], "severe": [...], "worst": {...}} for the state machine's Choice step.
Measured beats modelled; every row says which it is.
"""

from __future__ import annotations

import json
import math
import os
import time
import urllib.parse
import urllib.request
from decimal import Decimal

from gcorp.aws.handlers import band, pm_to_aqi

ZONES = {
    "narela": (28.853, 77.093), "rohini": (28.737, 77.115), "jahangirpuri": (28.726, 77.163), "shahdara": (28.673, 77.289),
    "wazirpur": (28.699, 77.165), "mundka": (28.682, 77.032), "punjabibagh": (28.668, 77.131), "ito": (28.628, 77.241),
    "anandvihar": (28.647, 77.316), "lodhi": (28.588, 77.222), "rkpuram": (28.563, 77.183), "dwarka": (28.590, 77.046), "okhla": (28.531, 77.271),
}
UA = {"User-Agent": "gcorp-ingest/0.3 (github.com/diiviikk5/gcorp)"}
ALERT_AQI = int(os.environ.get("GCORP_ALERT_AQI", "300"))  # Very poor and above


def _get(url: str, headers: dict | None = None, timeout: int = 25) -> dict | list:
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def modelled() -> dict[str, dict]:
    ids = list(ZONES)
    q = urllib.parse.urlencode({
        "latitude": ",".join(str(ZONES[z][0]) for z in ids), "longitude": ",".join(str(ZONES[z][1]) for z in ids),
        "hourly": "pm2_5,pm10,nitrogen_dioxide", "past_hours": 24, "forecast_hours": 1, "timezone": "Asia/Kolkata"})
    data = _get(f"https://air-quality-api.open-meteo.com/v1/air-quality?{q}")
    data = data if isinstance(data, list) else [data]
    out = {}
    for z, d in zip(ids, data):
        h = d["hourly"]
        pm = [x for x in h["pm2_5"] if x is not None]
        if not pm:
            continue
        mean = sum(pm) / len(pm)
        out[z] = {"pm25": round(mean, 1), "pm25Now": h["pm2_5"][-1], "pm10Now": h["pm10"][-1], "no2Now": h["nitrogen_dioxide"][-1],
                  "source": "Open-Meteo CAMS global model (coarse grid, ~40 km)", "kind": "modelled", "observedAt": h["time"][-1]}
    return out


def _openaq_key() -> str | None:
    name = os.environ.get("GCORP_OPENAQ_PARAM")
    if not name:
        return None
    try:
        import boto3
        return boto3.client("ssm").get_parameter(Name=name, WithDecryption=True)["Parameter"]["Value"]
    except Exception:
        return None


def measured(max_age_h: float = 3.0) -> dict[str, dict]:
    key = _openaq_key()
    if not key:
        return {}
    out: dict[str, dict] = {}
    try:
        locs = _get("https://api.openaq.org/v3/locations?coordinates=28.6139,77.2090&radius=25000&parameters_id=2&limit=100",
                    {"X-API-Key": key})["results"]
    except Exception:
        return {}
    now = time.time()
    for loc in locs:
        last = (loc.get("datetimeLast") or {}).get("utc")
        if not last:
            continue
        age = (now - time.mktime(time.strptime(last[:19], "%Y-%m-%dT%H:%M:%S")) + time.timezone) / 3600
        if age > max_age_h:
            continue
        lat, lon = loc["coordinates"]["latitude"], loc["coordinates"]["longitude"]
        z = min(ZONES, key=lambda k: math.hypot(ZONES[k][0] - lat, ZONES[k][1] - lon))
        if math.hypot(ZONES[z][0] - lat, ZONES[z][1] - lon) > 0.05:
            continue  # more than ~5 km from any zone centre
        sensor = next((s for s in loc.get("sensors", []) if (s.get("parameter") or {}).get("id") == 2), None)
        if not sensor:
            continue
        try:
            m = _get(f"https://api.openaq.org/v3/sensors/{sensor['id']}/hours?limit=24", {"X-API-Key": key})["results"]
        except Exception:
            continue
        vals = [r["value"] for r in m if r.get("value") is not None and r["value"] >= 0]
        if vals:
            out[z] = {"pm25": round(sum(vals) / len(vals), 1), "pm25Now": vals[0], "source": f"OpenAQ · {loc.get('name')}",
                      "kind": "measured", "observedAt": last, "ageHours": round(age, 1)}
        time.sleep(1.1)  # OpenAQ free-tier pacing
    return out


def handler(event=None, context=None):
    import boto3
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    zones = modelled()
    zones.update(measured())  # measured wins
    rows = []
    for z, r in zones.items():
        aqi = pm_to_aqi(r["pm25"])
        rows.append({"zone": z, "ts": ts, "aqi": aqi, "band": band(aqi), **r})
    table = os.environ.get("GCORP_READINGS_TABLE")
    if table:
        t = boto3.resource("dynamodb").Table(table)
        ttl = int(time.time()) + 30 * 86400
        with t.batch_writer() as w:
            for r in rows:
                w.put_item(Item=json.loads(json.dumps({**r, "ttl": ttl}), parse_float=Decimal))
    cw = boto3.client("cloudwatch")
    # City-level metrics only (custom metrics are billed each); per-zone history lives in DynamoDB.
    if rows:
        aqis = [r["aqi"] for r in rows]
        cw.put_metric_data(Namespace="Gcorp", MetricData=[
            {"MetricName": "CityMaxAQI", "Value": max(aqis), "Unit": "None"},
            {"MetricName": "CityMeanAQI", "Value": round(sum(aqis) / len(aqis), 1), "Unit": "None"},
            {"MetricName": "MeasuredZones", "Value": sum(r["kind"] == "measured" for r in rows), "Unit": "Count"}])
    severe = [r for r in rows if r["aqi"] >= ALERT_AQI]
    worst = max(rows, key=lambda r: r["aqi"]) if rows else None
    return {"ts": ts, "count": len(rows), "zones": rows, "severe": severe, "severeCount": len(severe), "worst": worst,
            "threshold": ALERT_AQI, "notify": _should_notify(worst, severe)}


def _should_notify(worst: dict | None, severe: list) -> bool:
    """At most one alert per COOLDOWN hours, unless the city gets into a worse band."""
    table = os.environ.get("GCORP_ALERTS_TABLE")
    if not (table and worst and severe):
        return False
    import boto3
    t = boto3.resource("dynamodb").Table(table)
    last = t.get_item(Key={"id": "last"}).get("Item")
    order = ["Good", "Satisfactory", "Moderate", "Poor", "Very poor", "Severe"]
    cooldown = float(os.environ.get("GCORP_ALERT_COOLDOWN_H", "6")) * 3600
    if last and time.time() - float(last["epoch"]) < cooldown and order.index(worst["band"]) <= order.index(last["band"]):
        return False
    t.put_item(Item={"id": "last", "epoch": Decimal(str(int(time.time()))), "band": worst["band"], "zone": worst["zone"]})
    return True

if __name__ == "__main__":
    print(json.dumps({z: (r["pm25"], pm_to_aqi(r["pm25"])) for z, r in modelled().items()}))
