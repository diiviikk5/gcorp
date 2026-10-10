# Air Council

## One-liner

A policy pre-check for municipal air-quality decisions. A planner types a policy in plain English (for example, "ban diesel autos in Ward 12 for six months"). A council of AI agents argues whether it works, a verifier rejects any claim it can't trace to a source, and a city map shows the estimated AQI change under explicit assumptions.

## Track

Track 01: Air (pollution, exposure, days the AQI goes off the chart).

## Problem

Municipal teams choose air-pollution policies with little evidence of what those policies would do to exposure in their own ward. Consultants are slow and expensive, and public debate tends to run on assumptions no one has checked.

## User

A planner or analyst at a municipal body who has to recommend yes or no before a meeting. Their question: "Is this worth doing here, and how sure are we?"

## Core principle

**Numbers come from the simulator and the data, never from the agents.** Agents argue about assumptions and interpretation. If an agent can produce a figure, the verifier has nothing meaningful to check.

## Output

- An AQI map that animates before and after the policy, by grid cell.
- A confidence band that widens where sensor data is thin.
- A transcript of the council debate, with rejected claims marked.
- Every number is clickable and links to its provenance row.
- The brief states the estimated reduction as a range under stated assumptions ("under these assumptions, the estimated reduction is X to Y"). It is never framed as a forecast.

## Architecture

### Stages (each writes an artifact to `runs/<run-id>/`)

| # | Stage | Who runs it | Output |
|---|---|---|---|
| 1 | Scope | Policy compiler (constrained extraction + LLM assist) | `scenario.json`: vehicle classes, % reduction, area, start date, duration. Every parameter is marked stated or assumed. Unknowns are flagged, not guessed. |
| 2 | Simulate | Grid simulator (deterministic, **not an agent**) | `results.json` with a range per grid cell, plus an input fingerprint. Same inputs must give the same output. |
| 3 | Challenge | Engineer, epidemiologist, economist | `objections.md`. Each objection names the input it would change. |
| 4 | Verify | Verifier | `claims.json`: each claim accepted (links to a ledger row), rejected, or unsourced. |
| 5 | Decide | Brief writer | `brief.md` containing only accepted claims. Coverage gaps are listed as stated limitations. |
| 6 | Reflect (optional for demo) | Calibration job | Past predictions compared with observed AQI, to improve the next run. |

### Roles

- **Compiler:** turns the sentence into `scenario.json`. Parser, not a reasoning agent.
- **Engineer:** challenges *how much* emissions change (traffic counts, fleet mix, road network).
- **Epidemiologist:** challenges *who breathes it and for how long* (population, exposure time, health link).
- **Economist:** challenges *who bears the cost* (for example, delivery riders, small transporters). Scope to one occupation group with available data, or drop it for the first build.
- **Skeptic:** argues against the policy and names the single weakest assumption and what evidence would settle it. Runs on a different model from the other agents.
- **Verifier:** checks sourcing only. It does not judge whether an argument is good.

### Gates

- Accepted claim: passes, with a ledger row.
- Unsourced claim: `[ASK]`. Surfaces to the planner as an open question. Not in the brief.
- Verdicts are bound to the scenario fingerprint. Change the policy and old verdicts go stale.

### Data

- AQI readings: OpenAQ, CPCB where available.
- Road network and tree/water access: OpenStreetMap.
- Traffic counts: TBD per ward. Confirm availability.
- Satellite NO₂ (Sentinel-5P): optional, for filling sensor gaps.
- Ledger row fields: source, URL, retrieved_at, value.

**Before building:** confirm the chosen ward has enough AQI coverage. Otherwise the confidence bands will be too wide to be useful.

### Visual layer

Priority order:
1. AQI change on the map (the hook)
2. Council debate with a visible rejection (the proof)
3. Ledger trace on click (the trust)
4. Extra polish or 3D (the bonus, only if the core runs by hour 24)

Use 2D or isometric (PixiJS or canvas) first. Hatch or blur uncertain areas. Pre-render a fallback video of a full run.

## AWS usage (only where it adds value)

- **Strands Agents SDK:** council and verifier orchestration.
- **Amazon Bedrock AgentCore Runtime:** hosts the orchestrator as one endpoint. The frontend makes one call and gets the transcript.
- **Step Functions (Map state):** runs scenario variants in parallel (with and without the ban, different durations) for the confidence bands.
- **Lambda + DynamoDB:** the provenance ledger.
- **AgentCore Memory:** optional, only if wards should remember past debates.

Skip EKS, Firecracker, Cedar, and other services that don't improve this product.

Verify current AgentCore Runtime deployment steps, invocation API, and regional availability in the AWS docs before building.

## Build plan (36 hours, solo)

- **0–6h:** pick ward, confirm AQI coverage, pull OSM roads, set up ledger (Lambda + DynamoDB).
- **6–14h:** simulator and policy compiler. One scenario produces an AQI change.
- **14–22h:** council agents and verifier on Strands, run locally. Rejection visible in the transcript.
- **22–30h:** map animation, confidence bands, transcript replay. Deploy to AgentCore around hours 26–28; keep local as fallback.
- **30–36h:** record demo, write one-slide pitch, keep a buffer.

## Demo script (90 seconds)

1. Open on a real AQI spike in the chosen ward.
2. Type the diesel-ban policy.
3. Show the compiler's translation into parameters.
4. Watch the council argue.
5. The verifier rejects one claim. Show the trace.
6. The map clears, with the confidence band visible.
7. Close with: "What would you have done?"

## Creative edges

- Show the policy-to-parameters translation on screen.
- Uncertainty is visible: thin data widens the band instead of the model looking confident.
- Replay mode: run a past real policy and compare the simulation to what happened.
- Rejected claims are shown, not hidden.

## Risks

- **Scope creep** in the visual layer. Cut to one excellent scene.
- **Overconfident map.** Never show a crisp boundary the model can't justify.
- **Simulator credibility.** A grid model estimates direction and rough magnitude, not precise AQI. Say so.
- **Deployment failure** on the judging day. Keep local run and recorded video as fallback.
- **Data gaps** in the chosen ward.

## Open questions

1. Which ward, and does it have enough AQI and traffic data?
2. What decision does the output change for the planner? If none, this is a demo, not a tool.
3. What does a good result look like? For example, the tool recommends against a policy that only helps a little, and says so.
4. Which single agent disagreement should the demo be built around?
5. Team skills (ML, full-stack, frontend) to set the scope.
6. Fourth track still unconfirmed.

## Instructions for Claude Code

- Build the simulator and compiler as plain Python modules. They must run without any LLM call.
- Agents live in `council/roles/*.md`. Stages live in `council/stages/*.md`. Each stage must write its artifact to `runs/<run-id>/` and must be runnable on its own.
- Do not let any agent output a number that isn't a ledger reference or a simulator output.
- Keep every visual number linked to its provenance row.
- Prefer a working local run before any deployment work.
- Mark assumptions explicitly in `scenario.json`. Do not guess missing parameters.
