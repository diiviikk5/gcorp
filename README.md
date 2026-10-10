# Gcorp

A pre-check for city air-quality policy. A planner types a policy in plain English, a council of AI agents debates whether it works, a verifier rejects any claim it can't trace to a source, and a 3D city shows the estimated AQI change as a range under stated assumptions.

Track 01 · Air. Pilot city: Delhi.

## What's here

```
docs/idea.md        product brief
web/                frontend (Vite + React 19 + three.js + Tailwind v4)
  src/sim/          deterministic simulator, policy compiler, mock council stream
  src/data/         provenance ledger (demo values, flagged as such)
  src/components/   city (R3F), landing figures (iso-glow SVG), app UI
  src/pages/        landing + app (overview, wizard, run, brief, compare, ledger)
```

## Run it

```bash
cd web
npm install
npm run dev
```

Open http://localhost:5173. The landing page is `/`; the console is `/app`.

## How the frontend is wired

- **Numbers never come from agents.** Agent text carries tokens (`[[L-011]]`, `[[sim:deltaRange]]`, `[[param:compliancePct]]`) that resolve to ledger rows, simulator output or scenario parameters. Every one is clickable and opens its provenance.
- **The simulator is not an agent.** `src/sim/simulator.ts` is deterministic: same inputs, same output, bound to an input fingerprint.
- **The debate moves the map.** Accepted objections change an input, the simulator re-runs, and the city updates.
- **The event stream matches the backend.** `src/sim/council.ts` emits the same `RunEvent` shape the AgentCore orchestrator will stream, so the mock can be swapped for the real SSE endpoint.

## Data

All ledger values are **demo data** shaped like real rows (CPCB/OpenAQ, OSM, source-apportionment studies). Replace them with retrieved figures before any real use.

## Credits

Landing figures use the projection kernel and glow vocabulary from [iso-glow](https://iso-glow.vercel.app) (MIT), which builds on iso-figure by Tolga Cohce.
