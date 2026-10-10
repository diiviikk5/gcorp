import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useMemo } from "react";
import type { ParamKey, RunRecord, Scenario, SimResult, SimSummary } from "@/lib/types";
import { api, type BackendRun, type BackendSim, type Confidence } from "@/lib/api";
import { registerRemoteRows } from "@/data/ledger";
import { compile } from "@/sim/compiler";
import { buildScript, type Script } from "@/sim/council";
import { simulate } from "@/sim/simulator";
import { fnv1a } from "@/sim/rng";

// Engine first, offline mock second. When the engine (local daemon or the
// AgentCore endpoint) answers, every run, verdict and re-sim comes from it.

type EngineState = "unknown" | "online" | "offline";

interface RunsState {
  runs: RunRecord[]; // offline runs (persisted)
  engine: EngineState;
  remote: Record<string, BackendRun>;
  remoteOrder: string[];
  connect: () => Promise<void>;
  createRun: (scenario: Scenario, kind?: RunRecord["kind"]) => string;
  createRemote: (text: string, zoneId?: string, overrides?: Record<string, number | string>) => Promise<string>;
  interject: (id: string, text: string) => Promise<void>;
  removeRun: (id: string) => void;
}

function seedRuns(): RunRecord[] {
  const mk = (text: string, zoneId: string | undefined, createdAt: string, kind: RunRecord["kind"] = "assessment", observed?: RunRecord["observed"]): RunRecord => {
    const sc = compile({ text, zoneId });
    const id = `r-${sc.fingerprint.slice(0, 6)}`;
    return { id, kind, createdAt, scenario: { ...sc, id }, observed };
  };
  return [
    mk("Ban diesel trucks from entering Anand Vihar at night for six months starting November", "anandvihar", "2026-10-09T16:40:00Z"),
    mk("Enforce construction dust rules across Okhla for 3 months", "okhla", "2026-10-09T11:05:00Z"),
    mk("Run odd-even for private cars across Delhi for 15 days in January 2016", undefined, "2026-10-08T18:22:00Z", "replay", { label: "Observed during Jan 1–15, 2016", deltaPct: 2, ledgerRef: "L-018" }),
    mk("Ban diesel autos in ITO for six months", "ito", "2026-10-08T09:12:00Z"),
  ];
}

export const useRuns = create<RunsState>()(
  persist(
    (set, get) => ({
      runs: seedRuns(),
      engine: "unknown",
      remote: {},
      remoteOrder: [],
      connect: async () => {
        try {
          await api.health();
          const [list, rows] = await Promise.all([api.runs(), api.ledger()]);
          registerRemoteRows(rows);
          const full = await Promise.all(list.map((r) => api.run(r.id)));
          set({ engine: "online", remote: Object.fromEntries(full.map((r) => [r.id, r])), remoteOrder: full.map((r) => r.id) });
        } catch {
          set({ engine: "offline" });
        }
      },
      createRun: (scenario, kind = "assessment") => {
        const id = `r-${fnv1a(scenario.fingerprint + Date.now()).slice(0, 6)}`;
        const rec: RunRecord = { id, kind, createdAt: new Date().toISOString(), scenario: { ...scenario, id } };
        set({ runs: [rec, ...get().runs] });
        return id;
      },
      createRemote: async (text, zoneId, overrides) => {
        const r = await api.create({ text, zoneId, overrides });
        set({ remote: { ...get().remote, [r.id]: r }, remoteOrder: [r.id, ...get().remoteOrder] });
        return r.id;
      },
      interject: async (id, text) => {
        const out = await api.interject(id, text);
        set({ remote: { ...get().remote, [id]: out.run } });
      },
      removeRun: (id) => set({ runs: get().runs.filter((r) => r.id !== id) }),
    }),
    { name: "gcorp-runs", version: 4, partialize: (s) => ({ runs: s.runs }) },
  ),
);

function toRecord(r: BackendRun): RunRecord {
  return { id: r.id, kind: r.kind, createdAt: r.createdAt, scenario: { ...r.scenario, id: r.id }, observed: r.observed ?? undefined };
}

/** The run list the UI shows: engine runs when online, offline runs otherwise. */
export function useRunList(): RunRecord[] {
  const engine = useRuns((s) => s.engine);
  const remote = useRuns((s) => s.remote);
  const order = useRuns((s) => s.remoteOrder);
  const local = useRuns((s) => s.runs);
  return useMemo(() => (engine === "online" ? order.map((id) => toRecord(remote[id])) : local), [engine, remote, order, local]);
}

// ---------------------------------------------------------------------------
// Bundles: script + simulator rounds per run, in one shape for both sources.

export interface RunBundle {
  record: RunRecord;
  script: Script;
  sims: Record<number, SimResult>;
  finalScenario: Scenario;
  remote: boolean;
  confidence?: Confidence | null;
}

const cache = new Map<string, RunBundle>();

export function withOverrides(s: Scenario, o: Partial<Record<ParamKey, number | string>>): Scenario {
  const params = { ...s.params };
  for (const [k, v] of Object.entries(o) as [ParamKey, number | string][]) {
    if (params[k]) params[k] = { ...params[k], value: v, origin: "assumed", note: "Changed by an accepted objection." };
  }
  return { ...s, params, fingerprint: fnv1a(s.fingerprint + JSON.stringify(o)) };
}

export function finalSim(b: RunBundle): SimResult {
  return b.sims[Math.max(...Object.keys(b.sims).map(Number))];
}

function adaptSim(s: BackendSim): SimResult {
  const f = (a?: number[]) => Float32Array.from(a ?? []);
  return { round: s.round, fingerprint: s.fingerprint, before: f(s.before), afterLo: f(s.afterLo), afterHi: f(s.afterHi), uncertainty: f(s.uncertainty), summary: s.summary as unknown as SimSummary };
}

function adapt(r: BackendRun): RunBundle {
  const sims: Record<number, SimResult> = {};
  for (const [k, v] of Object.entries(r.sims)) sims[Number(k)] = adaptSim(v);
  const script: Script = { events: r.events, claims: r.claims, finalOverrides: r.finalOverrides as Partial<Record<ParamKey, number>>, duration: r.duration };
  return { record: toRecord(r), script, sims, finalScenario: withOverrides(r.scenario, r.finalOverrides as Partial<Record<ParamKey, number | string>>), remote: true, confidence: r.confidence };
}

export function getBundle(record: RunRecord, remote?: BackendRun): RunBundle {
  if (remote) {
    const key = `remote:${remote.id}:${remote.events.length}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const b = adapt(remote);
    cache.set(key, b);
    return b;
  }
  const key = record.id + record.scenario.fingerprint;
  const hit = cache.get(key);
  if (hit) return hit;
  const script = buildScript(record.scenario);
  const finalScenario = withOverrides(record.scenario, script.finalOverrides);
  const sims: Record<number, SimResult> = { 1: simulate(record.scenario, 1) };
  sims[2] = Object.keys(script.finalOverrides).length ? simulate(finalScenario, 2) : { ...sims[1], round: 2 };
  const b = { record, script, sims, finalScenario, remote: false };
  cache.set(key, b);
  return b;
}

/** Bundle lookup usable outside React (lists, compare). */
export function bundleFor(record: RunRecord): RunBundle {
  const s = useRuns.getState();
  return getBundle(record, s.engine === "online" ? s.remote[record.id] : undefined);
}

export function useRun(id: string | undefined) {
  const engine = useRuns((s) => s.engine);
  const remote = useRuns((s) => (id ? s.remote[id] : undefined));
  const local = useRuns((s) => s.runs.find((r) => r.id === id));
  return useMemo(() => {
    if (engine === "online" && remote) return getBundle(toRecord(remote), remote);
    return local ? getBundle(local) : undefined;
  }, [engine, remote, local]);
}
