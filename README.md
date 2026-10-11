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
| **Council House** (`/council`) | Everyone watching | A 3D cutaway civic building where the agents live. Idle, they work their routines (desk, coffee, water cooler, records). When a run plays, every engine event becomes something they physically do: walking to the exact ledger drawer, carrying a claim to the Verifier's inbox, the stamp coming down, the simulator dial turning. The run clock waits for the bodies, so the story never runs ahead of them. |
| **Chamber** | Run view | A compact axonometric version of the same, inside each run. |
| **Street Lab** (`/app/lab`) | Planners, judges | A live dispersion sandbox on real Anand Vihar: OSM roads and buildings, street canyons, last week's real hourly wind and mixing height. Toggle a night or all-day truck ban, odd-even, compliance, and watch the change spread downwind street by street. |
| **Challenge** | Planners | Interrupt the council: "ANPR cameras at every entry?" The input changes, the simulator re-runs, the map updates. |
| **Plan** | Planners | Reverse the question: goal + budget → ranked policy portfolios with the chance each meets the goal. |
| **Track record** | Judges, press | Past Delhi policies replayed and scored against observed outcomes. Raw 2/4 → 4/4 after leave-one-out calibration. |
| **Breathe** | Schools, residents | Hourly exposure band and the cleanest outdoor window for a school day, with and without a policy. |
| **Sensor advisor** | Planners | Where one ₹15k sensor most narrows the uncertainty on this decision (value of information). |
| **Real streets** | Everyone | Anand Vihar in 3D from 1,486 OpenStreetMap buildings, with the real CPCB station. |

## The council

Compiler · **Source analyst** (is the target big enough?) · Engineer · Epidemiologist · Economist · **Externalities analyst** (what comes in from outside: stubble smoke, regional transport) · Skeptic (independent) · Verifier · Brief writer. Each role is a markdown contract in `backend/gcorp/council/roles/`.

Every brief carries a **confidence grade** built only from measurable things: sensor coverage, share of verified (vs demo) sources, share of inputs the planner stated, how much the debate moved the estimate, and open questions. A policy whose estimate swings a lot under debate is labelled *high variance*.

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
| Station PM2.5 | OpenAQ v3 | live with `OPENAQ_API_KEY` in `backend/.env`; readings carry their age (Delhi feeds were stale at last pull) |
| Upwind fires | NASA FIRMS (VIIRS) | live with `FIRMS_MAP_KEY` in `backend/.env` |
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

## AWS (live)

`gcorp aws up` provisions everything with boto3 (idempotent; ids in `~/.gcorp/aws.json`), `gcorp aws status` shows it, `gcorp aws down --yes` removes it. Region `ap-southeast-2`. Nothing here is needed to run offline.

| Service | What it does in Gcorp |
|---|---|
| **AgentCore Gateway** | The council's tools (ledger lookup/search, simulate, verify, propose a change, assess) as MCP tools, served by the `gcorp-tools` Lambda. IAM auth. |
| **AgentCore Policy** | Role contracts in **Cedar**, enforced on the gateway. Every agent calls as its own IAM role, so Cedar can say *the Externalities analyst may move `regionalPct`; the Economist may not; only the planner may launch a run*. A model that overreaches is refused before the tool runs, and the refusal is recorded on the claim. |
| **AgentCore Runtime** | The whole engine as a hosted agent (stdlib HTTP entrypoint). Runs come home and are re-simulated locally: the fingerprints match. |
| **Bedrock Guardrails** | Contextual grounding on every accepted claim. The verifier checks that each figure has a source; the guardrail checks that the sentence says what the source says. Weakly grounded claims are marked in the brief. |
| **Bedrock Knowledge Base** | Ledger rows and role contracts on **S3 Vectors** (no always-on vector DB). |
| **Bedrock models** | Optional council backend (Amazon Nova 2 Lite by default, any Converse model). Drafts still go through the verifier and the Cedar gate; falls back to playbooks if the model is unavailable, per agent, on record. |
| **Lambda + EventBridge Scheduler + Step Functions** | Hourly watch loop: ingest live air → where a zone crosses AQI 300, re-assess the watched policy there (Map, in parallel) → SNS alert (6 h cooldown) → DynamoDB. |
| **DynamoDB, S3, SSM, SNS, CloudWatch, Polly** | Readings/runs/alerts; run archive and KB docs; the OpenAQ key as a SecureString; alerts; a dashboard with ≤8 custom metrics; spoken briefs (en-IN). |

Live data: Open-Meteo's CAMS model for every zone (coarse, ~40 km) and OpenAQ measured PM2.5 where a station reading is under three hours old. Every reading says which it is.

```bash
gcorp aws up --email you@example.com   # provision; SNS sends a confirmation email
gcorp aws gate                         # same tool, different agents: Cedar permit/deny
gcorp aws readings                     # live Delhi AQI from DynamoDB
gcorp aws invoke "Ban trucks from entering Anand Vihar at night"   # run on AgentCore Runtime
gcorp aws watch --now                  # start the Step Functions loop now
```

In the web app: **AWS** page (services, Cedar test, live air, watch loop, KB search), a *Checked in AWS* section and per-claim grounding/Cedar marks in every brief, **Listen** (Polly), and *Run on AgentCore* / *Bedrock model* in New assessment.

Cost on the Free plan: no NAT, no OpenSearch, no always-on compute; a $100 budget with alerts. Bedrock model quotas start at zero on new accounts; everything else works without them.

## Demo (90 seconds)

1. Landing: the city draws itself in; the truck ban toggles and the dots thin.
2. Console → New assessment → "Ban diesel trucks from entering Anand Vihar at night…".
3. Chamber: watch the Engineer open drawer L-011, the Verifier **reject** a zone claim built on city-wide data.
4. Challenge: "ANPR cameras at every entry point" → re-simulated live.
5. Council House: convene the same policy and watch the agents walk it through the building.
6. Street Lab: scrub to a calm night and watch the truck ban clear the NH-24 corridor downwind.
7. Plan (goal → portfolio) and Track record (2/4 → 4/4, demo outcomes until replaced).
8. AWS: *Test the contracts* (AgentCore Policy refuses the economist), live Delhi air, the brief's *Checked in AWS* and **Listen**.
9. Close: "What would you have done?"

## Credits

Landing figures use the projection kernel from [iso-glow](https://iso-glow.vercel.app) (MIT), building on iso-figure by Tolga Cohce. CLI architecture inspired by [gstack](https://github.com/garrytan/gstack).
