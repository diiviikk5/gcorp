import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ParamKey, RunRecord, Scenario, SimResult } from "@/lib/types";
import { compile } from "@/sim/compiler";
import { buildScript, type Script } from "@/sim/council";
import { simulate } from "@/sim/simulator";
import { fnv1a } from "@/sim/rng";

interface RunsState {
  runs: RunRecord[];
  createRun: (scenario: Scenario, kind?: RunRecord["kind"]) => string;
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
    mk("Run odd-even for private cars across Delhi for 15 days in January 2016", undefined, "2026-10-08T18:22:00Z", "replay", { label: "Observed during Jan 1–15, 2016", deltaPct: 4, ledgerRef: "L-018" }),
    mk("Ban diesel autos in ITO for six months", "ito", "2026-10-08T09:12:00Z"),
  ];
}

export const useRuns = create<RunsState>()(
  persist(
    (set, get) => ({
      runs: seedRuns(),
      createRun: (scenario, kind = "assessment") => {
        const id = `r-${fnv1a(scenario.fingerprint + Date.now()).slice(0, 6)}`;
        const rec: RunRecord = { id, kind, createdAt: new Date().toISOString(), scenario: { ...scenario, id } };
        set({ runs: [rec, ...get().runs] });
        return id;
      },
      removeRun: (id) => set({ runs: get().runs.filter((r) => r.id !== id) }),
    }),
    { name: "air-council-runs", version: 3 },
  ),
);

// ---------------------------------------------------------------------------
// Derived, memoised bundles: script + both simulator rounds per run.

export interface RunBundle {
  record: RunRecord;
  script: Script;
  sims: Record<number, SimResult>;
  finalScenario: Scenario;
}

const cache = new Map<string, RunBundle>();

export function withOverrides(s: Scenario, o: Partial<Record<ParamKey, number>>): Scenario {
  const params = { ...s.params };
  for (const [k, v] of Object.entries(o) as [ParamKey, number][]) {
    params[k] = { ...params[k], value: v, origin: "assumed", note: "Changed by an accepted objection." };
  }
  return { ...s, params, fingerprint: fnv1a(s.fingerprint + JSON.stringify(o)) };
}

export function getBundle(record: RunRecord): RunBundle {
  const key = record.id + record.scenario.fingerprint;
  const hit = cache.get(key);
  if (hit) return hit;
  const script = buildScript(record.scenario);
  const finalScenario = withOverrides(record.scenario, script.finalOverrides);
  const sims: Record<number, SimResult> = { 1: simulate(record.scenario, 1) };
  sims[2] = Object.keys(script.finalOverrides).length ? simulate(finalScenario, 2) : { ...sims[1], round: 2 };
  const b = { record, script, sims, finalScenario };
  cache.set(key, b);
  return b;
}

export function useRun(id: string | undefined) {
  const rec = useRuns((s) => s.runs.find((r) => r.id === id));
  return rec ? getBundle(rec) : undefined;
}
