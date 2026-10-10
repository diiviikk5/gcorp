import type { AgentId, Claim, ParamKey, RunEvent, Scenario, StageId } from "@/lib/types";
import { getCity, zoneById } from "./city";

// Mock council. Produces the same event stream the AgentCore orchestrator will
// stream over SSE. Agents never emit raw numbers: every figure is a token that
// resolves to a ledger row ([[L-009]]), a simulator output ([[sim:deltaLo]]) or
// a scenario parameter ([[param:compliancePct]]).

export const AGENTS: Record<AgentId, { name: string; role: string; model: string; color: string; short: string }> = {
  compiler: { name: "Compiler", role: "Turns the sentence into parameters", model: "Parser + Claude Haiku assist", color: "var(--color-a-compiler)", short: "CP" },
  simulator: { name: "Simulator", role: "Deterministic grid model, not an agent", model: "Python · no LLM", color: "var(--color-a-simulator)", short: "SM" },
  engineer: { name: "Engineer", role: "How much do emissions actually change?", model: "Claude Sonnet", color: "var(--color-a-engineer)", short: "EN" },
  epidemiologist: { name: "Epidemiologist", role: "Who breathes it, and for how long?", model: "Claude Sonnet", color: "var(--color-a-epi)", short: "EP" },
  economist: { name: "Economist", role: "Who bears the cost?", model: "Claude Sonnet", color: "var(--color-a-econ)", short: "EC" },
  skeptic: { name: "Skeptic", role: "Argues against. Names the weakest assumption.", model: "Different model family", color: "var(--color-a-skeptic)", short: "SK" },
  verifier: { name: "Verifier", role: "Checks sourcing only, never argument quality", model: "Claude Haiku + ledger lookup", color: "var(--color-a-verifier)", short: "VF" },
  writer: { name: "Brief writer", role: "Writes only from accepted claims", model: "Template", color: "var(--color-a-writer)", short: "BW" },
  planner: { name: "Planner", role: "You", model: "Human", color: "var(--color-accent)", short: "YOU" },
};

export const STAGES: { id: StageId; label: string; agent: AgentId; artifact: string; blurb: string }[] = [
  { id: "scope", label: "Scope", agent: "compiler", artifact: "scenario.json", blurb: "Plain English to typed parameters" },
  { id: "simulate", label: "Simulate", agent: "simulator", artifact: "results.json", blurb: "Range per grid cell, fingerprinted" },
  { id: "challenge", label: "Challenge", agent: "engineer", artifact: "objections.md", blurb: "Each objection names the input it changes" },
  { id: "verify", label: "Verify", agent: "verifier", artifact: "claims.json", blurb: "Accepted, rejected, or [ASK]" },
  { id: "decide", label: "Decide", agent: "writer", artifact: "brief.md", blurb: "Only accepted claims make the brief" },
];

export interface Script {
  events: RunEvent[];
  claims: Record<string, Claim>;
  finalOverrides: Partial<Record<ParamKey, number>>;
  duration: number;
}

export function buildScript(s: Scenario): Script {
  const ev: RunEvent[] = [];
  const claims: Record<string, Claim> = {};
  const overrides: Partial<Record<ParamKey, number>> = {};
  const { city } = getCity();
  const zone = s.zoneId === "all" ? null : zoneById(s.zoneId);
  const focus: [number, number] = zone ? [zone.cx, zone.cz] : [15, 15];
  const near = (dx: number, dz: number): [number, number] => [Math.max(0, Math.min(city.size - 1, focus[0] + dx)), Math.max(0, Math.min(city.size - 1, focus[1] + dz))];
  let t = 0;
  let mid = 0;
  const at = (d: number) => (t += d);
  const msg = (agent: AgentId, text: string, extra: { claim?: Omit<Claim, "id" | "agent" | "status" | "text">; focus?: [number, number]; d?: number } = {}) => {
    const id = `m${++mid}`;
    let claimId: string | undefined;
    if (extra.claim) {
      claimId = `c${Object.keys(claims).length + 1}`;
      claims[claimId] = { id: claimId, agent, text, status: "pending", ...extra.claim };
    }
    ev.push({ t: at(extra.d ?? 1600), type: "message", id, agent, text, claimId, focus: extra.focus, model: AGENTS[agent].model });
    return claimId;
  };
  const verdict = (claimId: string, status: Claim["status"], reason: string, ledgerRef?: string, d = 1100) => {
    claims[claimId].status = status;
    claims[claimId].reason = reason;
    if (ledgerRef) claims[claimId].ledgerRef = ledgerRef;
    ev.push({ t: at(d), type: "verdict", claimId, status, reason, ledgerRef, focus: undefined });
  };
  const stage = (stage: StageId, status: "start" | "done", d = 500) => ev.push({ t: at(d), type: "stage", stage, status });

  const where = zone?.name ?? "Delhi";
  const isVehicle = ["trucks", "cars", "autos", "twoWheelers", "buses"].includes(s.vehicleClass);
  const blocked = s.warnings.some((w) => w.level === "block" && w.ledgerRef === "L-008");

  // 1 · Scope
  stage("scope", "start", 300);
  msg("compiler", `Parsed into ${Object.keys(s.params).length} parameters. Source [[param:vehicleClass]], area [[param:zone]], cut [[param:reductionPct]] of [[param:targetedShare]] in scope, for [[param:durationDays]].`, { focus, d: 900 });
  const assumed = Object.values(s.params).filter((p) => p.origin !== "stated").map((p) => p.label.toLowerCase());
  if (assumed.length) msg("compiler", `Not stated, so marked as assumptions: ${assumed.join(", ")}. None of these were guessed silently.`, { d: 1300 });
  stage("scope", "done", 600);

  // 2 · Simulate
  stage("simulate", "start", 300);
  ev.push({ t: at(900), type: "sim", round: 1 });
  msg("simulator", `Round 1 complete · fingerprint [[fp]]. Zone mean [[sim:zoneBefore]] → [[sim:zoneAfterRange]] under these assumptions. Band widens where stations are sparse.`, { focus, d: 1200 });
  stage("simulate", "done", 600);

  // 3 · Challenge + 4 · Verify (interleaved, as in the live system)
  stage("challenge", "start", 300);
  stage("verify", "start", 50);

  if (blocked) {
    const c1 = msg("engineer", `This targets diesel autos, but Delhi's auto fleet is CNG [[L-008]]. The share in scope is effectively nil, so the estimated change is within noise.`, { claim: { ledgerRef: "L-008" }, focus, d: 1800 })!;
    verdict(c1, "accepted", "Matches ledger row L-008 (fleet composition, Delhi 3W).", "L-008");
    const c2 = msg("epidemiologist", `Agreed: no exposure change to attribute. Any health claim here would be fabricated.`, { claim: {}, d: 1500 })!;
    verdict(c2, "accepted", "Interpretation only, no figure asserted.");
    const c3 = msg("skeptic", `Weakest assumption is that this policy does anything. Redirect the budget: in this corridor, [[param:vehicleClass]] are not the problem. Goods vehicles [[L-009]] and road dust [[L-003]] are.`, { claim: { ledgerRef: "L-003" }, focus: near(2, 1), d: 1800 })!;
    verdict(c3, "accepted", "Both figures resolve to ledger rows L-009, L-003.", "L-003");
  } else if (isVehicle) {
    const cars = s.vehicleClass === "cars";
    const leakRef = cars ? "L-017" : "L-011";
    const leakTo = cars ? 25 : 30;
    const c1 = msg("engineer", cars
      ? `Restricted car trips don't disappear. Many shift to exempted two-wheelers and cabs [[L-017]]. Input to change: displaced activity, 0 → that share.`
      : `Barred ${s.vehicleClass === "trucks" ? "trucks" : "vehicles"} won't vanish. Through-traffic reroutes to the peripheral corridor. Diversion after the expressway opened was [[L-011]]. Input to change: displaced activity, 0 → that value.`,
      { claim: { ledgerRef: leakRef, changes: { key: "leakagePct", from: 0, to: leakTo } }, focus: near(-3, 2), d: 2000 })!;
    verdict(c1, "accepted", `${leakRef} resolves and its scope matches. Re-simulating.`, leakRef);
    ev.push({ t: at(600), type: "param", key: "leakagePct", from: 0, to: leakTo, claimId: c1 });
    overrides.leakagePct = leakTo;

    const c2 = msg("engineer", `${cars ? "Cars" : "Trucks"} are the single largest source in ${where}. This should cut PM2.5 by about a third.`, { claim: {}, focus, d: 1900 })!;
    verdict(c2, "rejected", "No ledger row supports a zone-level figure. L-002 is a city-wide split, so the scope doesn't match. Number removed.", undefined, 1300);

    const c3 = msg("epidemiologist", `Exposure concentrates near arterials: ${zone ? zone.schools : "many"} schools sit within 500 m of one [[L-012]]. Night-time entry [[L-015]] means the residual load hits residents at home, not commuters.`, { claim: { ledgerRef: "L-012" }, focus: near(1, -2), d: 2000 })!;
    verdict(c3, "accepted", "L-012 (OSM school count) and L-015 (entry window) resolve.", "L-012");

    const c4 = msg("epidemiologist", `This should prevent a meaningful number of asthma admissions in ${where}.`, { claim: {}, d: 1600 })!;
    verdict(c4, "ask", "No local dose-response or admissions data [[L-022]]. Moved to open questions, kept out of the brief.", "L-022");

    const c5 = msg("economist", `Cost falls on small operators: [[L-014]] of goods-vehicle operators run two trucks or fewer and can't easily shift to compliant fleets.`, { claim: { ledgerRef: "L-014" }, focus: near(3, 3), d: 1900 })!;
    verdict(c5, "accepted", "L-014 resolves (VAHAN extract).", "L-014");

    const c6 = msg("skeptic", `Weakest assumption: compliance at [[param:compliancePct]], borrowed from a car scheme [[L-010]]. Trucks at night are harder to police. Evidence that settles it: two weeks of ANPR counts at the border entry points. Meanwhile, stubble smoke [[L-007]] can swamp the local gain on peak days.`, { claim: { ledgerRef: "L-007", changes: { key: "compliancePct", from: 70, to: 55 } }, focus: near(4, 0), d: 2400 })!;
    verdict(c6, "accepted", "L-007 and L-010 resolve. Lower compliance bound adopted as a sensitivity case.", "L-007");
    ev.push({ t: at(500), type: "param", key: "compliancePct", from: 70, to: 55, claimId: c6 });
    overrides.compliancePct = 55;
  } else {
    const c1 = msg("engineer", `Only sites not already following dust rules are in scope [[L-019]]. Point sources mean the effect stays local; little spillover expected.`, { claim: { ledgerRef: "L-019" }, focus, d: 1900 })!;
    verdict(c1, "accepted", "L-019 resolves (DPCC inspection summary).", "L-019");
    const c2 = msg("engineer", `Dust enforcement typically halves construction PM within weeks.`, { claim: {}, focus, d: 1600 })!;
    verdict(c2, "rejected", "No ledger row for effect size of enforcement. Number removed.");
    const c3 = msg("epidemiologist", `${zone ? zone.schools : "Many"} schools in the zone [[L-012]]; site work runs in school hours, so daytime exposure dominates.`, { claim: { ledgerRef: "L-012" }, focus: near(1, 1), d: 1900 })!;
    verdict(c3, "accepted", "L-012 resolves.", "L-012");
    const c4 = msg("skeptic", `Weakest assumption: inspection capacity. Compliance [[param:compliancePct]] assumes inspectors visit every site. Settle it with the DPCC inspection roster for one month.`, { claim: { ledgerRef: "L-019", changes: { key: "compliancePct", from: 70, to: 60 } }, d: 2200 })!;
    verdict(c4, "accepted", "Sensitivity case adopted.", "L-019");
    ev.push({ t: at(500), type: "param", key: "compliancePct", from: 70, to: 60, claimId: c4 });
    overrides.compliancePct = 60;
  }

  stage("challenge", "done", 500);

  if (!blocked) {
    ev.push({ t: at(900), type: "sim", round: 2 });
    msg("simulator", `Round 2 with accepted objections · fingerprint [[fp]]. Zone mean now [[sim:zoneAfterRange]]. Spillover to neighbours [[sim:spillover]].`, { focus, d: 1300 });
  }
  stage("verify", "done", 400);

  // 5 · Decide
  stage("decide", "start", 300);
  msg("writer", blocked
    ? `Brief drafted. Recommendation: do not proceed. The policy targets a near-empty fleet segment. Accepted claims only; open questions listed separately.`
    : `Brief drafted from accepted claims only. Under these assumptions, the estimated reduction is [[sim:deltaRange]] AQI points ([[sim:pctRange]]). Rejected and unsourced claims are excluded.`, { d: 1500 });
  stage("decide", "done", 700);
  ev.push({ t: at(400), type: "complete" });

  return { events: ev, claims, finalOverrides: overrides, duration: t };
}
