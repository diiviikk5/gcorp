// Engine client. One endpoint for everything: the local daemon today
// (gcorp serve), the AgentCore Runtime URL later. Set VITE_GCORP_ENDPOINT.

export const ENDPOINT = (import.meta.env.VITE_GCORP_ENDPOINT as string | undefined)?.replace(/\/$/, "") || "http://localhost:8000";

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(ENDPOINT + path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json() as Promise<T>;
}

export interface BackendSim {
  round: number;
  fingerprint: string;
  inputs: Record<string, unknown>;
  summary: Record<string, number | string | number[]>;
  before?: number[];
  afterLo?: number[];
  afterHi?: number[];
  uncertainty?: number[];
}

export interface BackendRun {
  id: string;
  kind: "assessment" | "replay";
  createdAt: string;
  scenario: import("./types").Scenario;
  events: import("./types").RunEvent[];
  claims: Record<string, import("./types").Claim>;
  sims: Record<string, BackendSim>;
  finalOverrides: Record<string, number | string>;
  duration: number;
  observed?: { label: string; deltaPct: number; ledgerRef: string } | null;
}

export const api = {
  health: () => j<{ ok: boolean; runs: number; ledgerRows: number }>("/api/health"),
  runs: () => j<BackendRun[]>("/api/runs"),
  run: (id: string) => j<BackendRun>(`/api/runs/${id}`),
  create: (body: { text: string; zoneId?: string; overrides?: Record<string, number | string> }) => j<BackendRun>("/api/runs", { method: "POST", body: JSON.stringify(body) }),
  interject: (id: string, text: string) => j<{ events: import("./types").RunEvent[]; run: BackendRun }>(`/api/runs/${id}/interject`, { method: "POST", body: JSON.stringify({ text }) }),
  ledger: () => j<import("./types").LedgerRow[]>("/api/ledger"),
  optimise: (zone: string, target: number, budget: number, months: number) => j<OptimiseResult>(`/api/optimise?zone=${zone}&target=${target}&budget=${budget}&months=${months}`),
  trackRecord: () => j<TrackRecord>("/api/track-record"),
  sensors: (id: string) => j<SensorAdvice>(`/api/runs/${id}/sensors`),
};

export interface Lever { id: string; label: string; policy: string; cost: number; costRef: string; deltaLo: number; deltaHi: number; childHoursLo: number; childHoursHi: number }
export interface Portfolio { levers: string[]; labels: string[]; cost: number; deltaLo: number; deltaHi: number; pTarget: number; childHoursLo: number; childHoursHi: number }
export interface OptimiseResult { zone: string; target: number; budget: number; months: number; levers: Lever[]; portfolios: Portfolio[]; note: string | null }
export interface TrackCase { id: string; name: string; policy: string; class: string; predicted: [number, number]; calibrated: [number, number]; factor: number; calibratedFrom: string[]; observed: [number, number]; observedRef: string; hit: boolean; hitCalibrated: boolean }
export interface TrackRecord { cases: TrackCase[]; total: number; hits: number; hitsCalibrated: number; score: number; scoreCalibrated: number; note: string }
export interface SensorAdvice { zone: string; bandWidth: number; candidates: { x: number; z: number; bandWidth: number; reduction: number }[]; unitCost: string | null; unitCostRef: string }
