"""HTTP API. Locally: uvicorn gcorp.api:app --reload --port 8000

In deployment the same orchestrator runs inside AgentCore Runtime; the web app
keeps calling these routes.
"""

from __future__ import annotations

import asyncio
import json
import os
import time

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import ledger
from .city import ZONES, get_city, zone_baseline, zone_coverage
from .compiler import compile_policy
from .orchestrator import Run, execute, interject
from .simulator import school_cells

app = FastAPI(title="Gcorp engine", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_methods=["*"], allow_headers=["*"])

RUNS: dict[str, Run] = {}

SEEDS = [
    ("Ban diesel trucks from entering Anand Vihar at night for six months starting November", "anandvihar", "assessment", "2026-10-09T16:40:00Z", None),
    ("Enforce construction dust rules across Okhla for 3 months", "okhla", "assessment", "2026-10-09T11:05:00Z", None),
    ("Run odd-even for private cars across Delhi for 15 days in January 2016", None, "replay", "2026-10-08T18:22:00Z",
     {"label": "Observed during Jan 1–15, 2016", "deltaPct": 2, "ledgerRef": "L-018"}),
    ("Ban diesel autos in ITO for six months", "ito", "assessment", "2026-10-08T09:12:00Z", None),
]


_last_hit = [time.time()]


@app.middleware("http")
async def _touch(request, call_next):
    _last_hit[0] = time.time()
    return await call_next(request)


async def _idle_watch(limit: float) -> None:
    while True:
        await asyncio.sleep(30)
        if time.time() - _last_hit[0] > limit:
            os._exit(0)  # daemon mode: auto-shutdown after idle (gstack model)


@app.on_event("startup")
async def _idle() -> None:
    if os.environ.get("GCORP_IDLE_EXIT"):
        asyncio.get_event_loop().create_task(_idle_watch(float(os.environ["GCORP_IDLE_EXIT"])))


@app.on_event("startup")
def _seed() -> None:
    for text, zone, kind, created, observed in SEEDS:
        r = execute(text, zone, kind=kind, created_at=created)
        r.observed = observed
        RUNS[r.id] = r


class RunIn(BaseModel):
    text: str
    zoneId: str | None = None
    overrides: dict[str, float | str] | None = None
    kind: str = "assessment"


class InterjectIn(BaseModel):
    text: str


def _get(run_id: str) -> Run:
    r = RUNS.get(run_id)
    if not r:
        raise HTTPException(404, f"No run {run_id}")
    return r


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "runs": len(RUNS), "ledgerRows": len(ledger.all_rows())}


@app.get("/api/city")
def city() -> dict:
    c, base, unc = get_city()
    return {
        "size": c.size,
        "zones": [{**z.__dict__, "baseline": zone_baseline(z.id), "coverage": zone_coverage(z.id)} for z in ZONES],
        "stations": [s.__dict__ for s in c.stations],
        "baseline": [round(v, 2) for v in base],
        "uncertainty": [round(v, 3) for v in unc],
        "schools": sorted(school_cells()),
    }


@app.post("/api/compile")
def compile_(body: RunIn) -> dict:
    return compile_policy(body.text, body.zoneId, body.overrides).to_json()


@app.post("/api/runs")
def create_run(body: RunIn) -> dict:
    r = execute(body.text, body.zoneId, body.overrides, kind=body.kind)
    RUNS[r.id] = r
    return r.to_json()


@app.get("/api/runs")
def list_runs() -> list[dict]:
    rs = sorted(RUNS.values(), key=lambda r: r.created_at, reverse=True)
    return [r.to_json(grids=False) for r in rs]


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict:
    return _get(run_id).to_json()


@app.post("/api/runs/{run_id}/interject")
def post_interject(run_id: str, body: InterjectIn) -> dict:
    r = _get(run_id)
    new = interject(r, body.text)
    return {"events": new, "run": r.to_json()}


@app.get("/api/runs/{run_id}/stream")
async def stream(run_id: str, speed: float = 1.0) -> StreamingResponse:
    """Server-sent events, paced on the recorded timeline (AgentCore parity)."""
    r = _get(run_id)

    async def gen():
        last = 0
        for ev in list(r.events):
            await asyncio.sleep(max(0, (ev["t"] - last) / 1000 / max(0.1, speed)))
            last = ev["t"]
            yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/api/ledger")
def get_ledger() -> list[dict]:
    return ledger.all_rows()


@app.get("/api/ledger/{row_id}")
def get_row(row_id: str) -> dict:
    row = ledger.get(row_id)
    if not row:
        raise HTTPException(404, f"No ledger row {row_id}")
    return row


# --------------------------------------------------------------------------- planning engines
from .planning import optimise as _optimise, sensor_advice as _sensor_advice, track_record as _track_record  # noqa: E402


@app.get("/api/optimise")
def optimise(zone: str = "anandvihar", target: float = 15, budget: float = 2, months: int = 3) -> dict:
    """Reverse the question: goal + budget -> ranked portfolios of policies."""
    return _optimise(zone, target, budget, months)


@app.get("/api/track-record")
def track_record() -> dict:
    return _track_record()


@app.get("/api/runs/{run_id}/sensors")
def sensors(run_id: str) -> dict:
    r = _get(run_id)
    return _sensor_advice(r.scenario.text, r.scenario.zone_id)


@app.post("/api/reload")
def reload_data() -> dict:
    """Pick up rows from `gcorp data pull` without restarting."""
    ledger.reload()
    return {"ledgerRows": len(ledger.all_rows())}


@app.get("/api/breathe")
def breathe(zone: str = "anandvihar", run: str | None = None) -> dict:
    from .planning import breathe as _breathe
    hourly = None
    if run and run in RUNS:
        sims = RUNS[run].sims
        hourly = sims[max(sims)]["summary"].get("hourly")
    return _breathe(zone, hourly)


@app.get("/api/ward/{zone}")
def ward(zone: str) -> dict:
    """Real geometry around a zone (OpenStreetMap), cached by `gcorp data pull --ward`."""
    from .data import load
    w = load(f"ward_{zone}.json")
    if not w:
        raise HTTPException(404, f"No ward geometry for {zone}; run `gcorp data ward {zone}`")
    return w


@app.get("/api/council")
def council() -> dict:
    """Role contracts (council/roles/*.md) for the Council House and CLI."""
    from .council import AGENTS
    return AGENTS
