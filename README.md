# gcorp

**Test an air policy before the city pays for it.**

A planner types a policy in plain English. A council of agents argues whether it works, a verifier strikes every claim it can't trace to a source, a deterministic simulator gives the change as an honest range, and a 3D Delhi shows where it lands. The same engine runs from the browser and from the terminal.

Track 01 · Air. Pilot city: Delhi.

```
gcorp CLI / TUI ─┐
                 ├── HTTP ──▶ engine  (local daemon today, AgentCore Runtime URL later)
web console  ────┘            compiler · simulator · council · verifier · ledger · data
```

## What it does

| Surface | Who it's for | What it does |
|---|---|---|
| **Run** | Planners | Policy → parameters (stated / assumed / unknown) → simulator range → council debate → verified brief. Every number on screen opens its source. |
| **Chamber** | Everyone watching | The council at work: desks, the ledger cabinet (the drawer an agent opens lights up), the simulator, the verifier's stamps. Driven by the engine's real action events. |
| **Challenge** | Planners | Interrupt the council: "ANPR cameras at every entry?" The input changes, the simulator re-runs, the map updates. |
| **Plan** | Planners | Reverse the question: goal + budget → ranked policy portfolios with the chance each meets the goal. |
| **Track record** | Judges, press | Past Delhi policies replayed and scored against observed outcomes. Raw 2/4 → 4/4 after leave-one-out calibration. |
| **Breathe** | Schools, residents | Hourly exposure band and the cleanest outdoor window for a school day, with and without a policy. |
| **Sensor advisor** | Planners | Where one ₹15k sensor most narrows the uncertainty on this decision (value of information). |
| **Real streets** | Everyone | Anand Vihar in 3D from 1,486 OpenStreetMap buildings, with the real CPCB station. |

## The rules that make it trustworthy

1. **Agents never produce numbers.** They argue about assumptions and cite `[[L-011]]` (ledger), `[[sim:deltaRange]]` (simulator) or `[[param:compliancePct]]`.
2. **The verifier checks sourcing only** (`backend/gcorp/verifier.py`): a figure in plain text → rejected; a missing ledger row → rejected; a health outcome without data → `[ASK]`; a zone-level claim resting on city-wide data → rejected (scope mismatch).
3. **The simulator is not an agent.** Deterministic, fingerprinted, ~25 ms per run. It is the only thing allowed to say what the future might look like, and only as a range.
4. **Roles are contracts.** Each agent is a markdown file in `backend/gcorp/council/roles/` with its allowed tools and the inputs it may change. The engine enforces them.
5. **Unknowns are flagged, never guessed.** The brief lists assumptions, open questions and the claims it excluded.

## Run it

```bash
# engine + CLI
cd backend
python -m venv .venv && .venv/Scripts/activate      # macOS/Linux: source .venv/bin/activate
pip install -e .
gcorp data pull                 # real weather (Open-Meteo), schools & hospitals (OSM), OpenAQ if keyed
gcorp data ward anandvihar      # real building footprints for the 3D view
gcorp serve                     # engine on http://127.0.0.1:8000

# web
cd web && npm install && npm run dev   # http://localhost:5173
```

### The CLI (gstack-style: thin client, auto-started daemon)

```bash
gcorp run "Ban diesel trucks from entering Anand Vihar at night for six months" --zone anandvihar --watch
gcorp ask <run-id> "ANPR cameras at every entry point"
gcorp brief <run-id>
gcorp optimise --zone anandvihar --target 15 --budget 2
gcorp track-record
gcorp sensors <run-id>
gcorp ledger L-024
gcorp council
gcorp status | stop
gcorp config set endpoint https://<agentcore-runtime-url>   # point CLI + web at a deployed engine
```

The first command starts the engine as a daemon (`~/.gcorp/engine.json`: pid, port, token), health-checks it, and it shuts itself down after 30 idle minutes. `--json` on any command gives machine-readable output.

## Data

| Data | Source | Status |
|---|---|---|
| Mixing height, wind | Open-Meteo | **live** (`gcorp data pull`) |
| Schools, hospitals per zone | OpenStreetMap / Overpass | **live** |
| Building footprints, roads | OpenStreetMap / Overpass | **live** (`gcorp data ward`) |
| Station PM2.5 | OpenAQ v3 | live with `OPENAQ_API_KEY` in `backend/.env` |
| Source apportionment, costs, past-policy outcomes | IIT Kanpur 2016, TERI-ARAI 2018, published evaluations | demo rows, flagged in the UI until replaced |

Rows pulled live are marked `verified` with their retrieval time and query URL; everything else is visibly `demo`.

## Layout

```
backend/gcorp/
  compiler.py      sentence → scenario.json (no LLM)
  simulator.py     deterministic grid model: weather, time of day, school exposure
  council/         role contracts (roles/*.md), stage notes, rule backend (LLM backend slots in here)
  verifier.py      sourcing rules
  orchestrator.py  stages → runs/<id>/{scenario.json, results.round-N.json, objections.md, claims.json, brief.md, events.json}
  planning.py      optimiser, calibrated track record, sensor advisor, breathe
  data.py          Open-Meteo, Overpass, OpenAQ pulls → cached, verified ledger rows
  api.py           FastAPI + SSE stream
  cli.py, client.py  gcorp CLI, live TUI, daemon discovery
web/src/
  pages/           landing, overview, wizard, run (city · chamber · real streets), brief, plan, track record, breathe, compare, ledger
  components/      city (R3F), landing figures (iso-glow SVG), chamber, UI kit
```

## AWS (next, not yet deployed)

Strands Agents for the council and verifier · Bedrock AgentCore Runtime hosting the orchestrator as one endpoint · Step Functions Map for scenario variants · Lambda + DynamoDB for the ledger. The engine already speaks the same contract, so the CLI and web switch over with one `endpoint` setting.

## Demo (90 seconds)

1. Landing: the city draws itself in; the truck ban toggles and the haze thins.
2. Console → New assessment → "Ban diesel trucks from entering Anand Vihar at night…".
3. Chamber: watch the Engineer open drawer L-011, the Verifier **reject** a zone claim built on city-wide data.
4. Challenge: "ANPR cameras at every entry point" → re-simulated live.
5. Real streets, then Plan (goal → portfolio) and Track record (2/4 → 4/4).
6. Close: "What would you have done?"

## Credits

Landing figures use the projection kernel from [iso-glow](https://iso-glow.vercel.app) (MIT), building on iso-figure by Tolga Cohce. CLI architecture inspired by [gstack](https://github.com/garrytan/gstack).
