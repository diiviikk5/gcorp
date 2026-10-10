"""Provenance ledger. Local JSON today; the same interface fronts the
DynamoDB table behind the ledger Lambda in deployment.

Every row carries a scope level so the verifier can reject claims that cite a
city-wide figure for a zone-level statement.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from .city import get_city

DATA = Path(__file__).parent / "data"
RETRIEVED = "2026-10-08T09:30:00Z"

# Rows added on top of the exported frontend ledger. All demo-flagged.
EXTRA_ROWS = [
    {"id": "L-023", "label": "Diurnal traffic profile, Delhi arterials", "value": "peaks 08–10 and 17–20 h", "source": "Traffic police counts summary", "url": "https://traffic.delhipolice.gov.in", "scope": "City-wide", "status": "demo"},
    {"id": "L-024", "label": "Winter mixing-height and wind regime", "value": "calm 0.3–0.5 km · windy > 1 km", "source": "Open-Meteo reanalysis (boundary layer height, 10 m wind)", "url": "https://open-meteo.com", "scope": "Delhi NCR, Nov–Jan", "status": "demo"},
    {"id": "L-025", "label": "Cost of ANPR enforcement per entry point", "value": "₹0.6 crore / year", "source": "Transport Department tender estimates", "url": "https://transport.delhi.gov.in", "scope": "Per entry point", "status": "demo"},
    {"id": "L-026", "label": "Cost of construction-site inspections", "value": "₹0.2 crore / zone / quarter", "source": "DPCC budget documents", "url": "https://www.dpcc.delhigovt.nic.in", "scope": "Per zone", "status": "demo"},
    {"id": "L-027", "label": "Low-cost PM2.5 sensor, installed", "value": "₹15,000 per unit", "source": "Vendor quotes, calibrated optical sensors", "url": "https://openaq.org", "scope": "Per unit", "status": "demo"},
    {"id": "L-028", "label": "Observed PM2.5 change, odd-even Nov 4–15, 2019", "value": "−1% to −4%", "source": "Independent evaluations of odd-even, 2019", "url": "https://transport.delhi.gov.in", "scope": "City-wide", "status": "demo"},
    {"id": "L-029", "label": "Observed change during construction ban (GRAP III, Nov 2021)", "value": "−2% to −6%", "source": "CAQM / CPCB bulletins", "url": "https://caqm.nic.in", "scope": "City-wide", "status": "demo"},
    {"id": "L-030", "label": "Observed change, heavy-vehicle entry curbs (Nov 2023)", "value": "−3% to −9% (east Delhi)", "source": "CPCB station data, Anand Vihar / Patparganj", "url": "https://cpcb.nic.in", "scope": "East Delhi", "status": "demo"},
    {"id": "L-031", "label": "Cost of private-car rationing (enforcement + transit top-up)", "value": "₹4 crore / fortnight", "source": "Transport Department, odd-even 2016 accounts", "url": "https://transport.delhi.gov.in", "scope": "City-wide", "status": "demo"},
]

# Scope level used by the verifier: city | district | zone | point | none.
SCOPE_LEVEL = {
    "L-001": "city", "L-002": "city", "L-003": "city", "L-004": "city", "L-005": "city", "L-006": "city",
    "L-007": "city", "L-008": "city", "L-009": "point", "L-010": "city", "L-011": "district", "L-012": "zone",
    "L-013": "zone", "L-014": "city", "L-015": "city", "L-016": "city", "L-017": "city", "L-018": "city",
    "L-019": "city", "L-020": "zone", "L-021": "zone", "L-022": "none", "L-023": "city", "L-024": "city",
    "L-025": "point", "L-026": "zone", "L-027": "point", "L-028": "city", "L-029": "city", "L-030": "district", "L-031": "city",
}


@lru_cache(maxsize=1)
def rows() -> dict[str, dict]:
    base = json.loads((DATA / "ledger.json").read_text(encoding="utf-8"))
    out: dict[str, dict] = {}
    for r in base + EXTRA_ROWS:
        r = {**r, "retrievedAt": r.get("retrievedAt", RETRIEVED)}
        r["scopeLevel"] = SCOPE_LEVEL.get(r["id"], "city")
        out[r["id"]] = r
    # Real pulls (gcorp data pull) override demo rows and add per-zone rows.
    from .data import verified_rows
    for r in verified_rows():
        out[r["id"]] = {**out.get(r["id"], {}), **r, "scopeLevel": r.get("scopeLevel", out.get(r["id"], {}).get("scopeLevel", "city"))}
    city, _, _ = get_city()
    for s in city.stations:
        out[s.ledger_ref] = {
            "id": s.ledger_ref, "label": f"AQI station · {s.name}", "value": str(s.aqi), "unit": "AQI (24 h)",
            "source": "CPCB CAAQMS via OpenAQ", "url": "https://openaq.org", "retrievedAt": RETRIEVED,
            "scope": f"Station {s.id}, 24 h mean", "status": "demo", "scopeLevel": "point",
        }
    return out


def reload() -> None:
    rows.cache_clear()


def get(row_id: str) -> dict | None:
    return rows().get(row_id)


def all_rows() -> list[dict]:
    return list(rows().values())
