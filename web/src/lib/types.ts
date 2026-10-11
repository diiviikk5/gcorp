// Shapes mirror the backend artifacts in runs/<run-id>/ so the mock layer
// can be swapped for the real AgentCore stream without touching the UI.

export type Origin = "stated" | "assumed" | "unknown";

export type VehicleClass =
  | "trucks"
  | "autos"
  | "cars"
  | "twoWheelers"
  | "buses"
  | "construction"
  | "industry"
  | "wasteBurning";

export type CellKind = "road" | "arterial" | "river" | "park" | "building" | "industrial" | "open";

export interface Cell {
  x: number;
  z: number;
  kind: CellKind;
  zone: string;
  height: number; // building height in world units, 0 for flat cells
  roadWeight: number; // 0..1 traffic intensity proxy
  population: number; // relative residents
}

export interface Station {
  id: string;
  name: string;
  x: number;
  z: number;
  aqi: number;
  ledgerRef: string;
}

export interface Zone {
  id: string;
  name: string;
  district: string;
  cx: number;
  cz: number;
  character: "dense" | "mixed" | "industrial" | "green" | "transit" | "suburban";
  schools: number;
  hospitals: number;
  populationK: number;
}

export interface City {
  size: number;
  cells: Cell[];
  zones: Zone[];
  stations: Station[];
}

export interface ScenarioParam {
  key: ParamKey;
  label: string;
  value: number | string | null;
  unit?: string;
  origin: Origin;
  note?: string;
  ledgerRef?: string;
}

export type ParamKey =
  | "vehicleClass"
  | "fuelFilter"
  | "zone"
  | "reductionPct"
  | "targetedShare"
  | "compliancePct"
  | "leakagePct"
  | "durationDays"
  | "startDate"
  | "hours"
  | "weather"
  | "regionalPct";

export interface CompilerWarning {
  level: "info" | "warn" | "block";
  text: string;
  ledgerRef?: string;
}

export interface Scenario {
  id: string;
  text: string;
  title: string;
  vehicleClass: VehicleClass;
  zoneId: string | "all";
  params: Record<ParamKey, ScenarioParam>;
  warnings: CompilerWarning[];
  fingerprint: string;
}

export interface SimSummary {
  zoneBefore: number;
  zoneAfterLo: number;
  zoneAfterHi: number;
  deltaLo: number; // AQI points reduced, conservative
  deltaHi: number; // AQI points reduced, optimistic
  pctLo: number;
  pctHi: number;
  exposureLo: number; // relative person-AQI-days averted
  exposureHi: number;
  spillover: number; // AQI change in neighbouring zones (negative = worse)
  coverage: "good" | "thin" | "none";
  bandWidth: number; // mean uncertainty, AQI points
  schoolCells?: number;
  childHoursLo?: number;
  childHoursHi?: number;
  hourly?: number[];
  ceilingPct?: number;
  regionalPct?: number;
}

export interface SimResult {
  round: number;
  fingerprint: string;
  before: Float32Array;
  afterLo: Float32Array;
  afterHi: Float32Array;
  uncertainty: Float32Array; // 0..1 per cell
  summary: SimSummary;
}

export type AgentId =
  | "compiler"
  | "simulator"
  | "engineer"
  | "epidemiologist"
  | "economist"
  | "skeptic"
  | "verifier"
  | "writer"
  | "planner"
  | "apportionment"
  | "externalities";

export type StageId = "scope" | "simulate" | "challenge" | "verify" | "decide";

export type ClaimStatus = "pending" | "accepted" | "rejected" | "ask";

export interface Claim {
  id: string;
  agent: AgentId;
  text: string;
  status: ClaimStatus;
  ledgerRef?: string;
  reason?: string;
  rule?: string;
  scope?: string;
  changes?: { key: ParamKey; from: number | string; to: number | string };
  /** Bedrock Guardrails contextual grounding (AWS mode): does the sentence say what its sources say? */
  grounding?: { ok: boolean; action?: string; scores?: { grounding?: { score: number; threshold: number; action: string } }; error?: string };
  /** AgentCore Policy (Cedar) decision on this claim's parameter change (AWS mode). */
  gate?: { engine: string; decision: "permit" | "deny" | "error"; agent: string; key: string; error?: string };
}

export type RunEvent =
  | { t: number; type: "stage"; stage: StageId; status: "start" | "done" }
  | { t: number; type: "message"; id: string; agent: AgentId; text: string; claimId?: string; focus?: [number, number]; model?: string }
  | { t: number; type: "verdict"; claimId: string; status: ClaimStatus; ledgerRef?: string; reason: string; rule?: string; focus?: [number, number] }
  | { t: number; type: "param"; key: ParamKey; from: number | string; to: number | string; claimId: string }
  | { t: number; type: "action"; agent: AgentId; tool: "ledger.lookup" | "sim.run" | "claim.submit" | "verify" | "param.propose"; target: string; detail?: string }
  | { t: number; type: "sim"; round: number }
  | { t: number; type: "complete" };

export interface LedgerRow {
  id: string;
  label: string;
  value: string;
  unit?: string;
  source: string;
  url: string;
  retrievedAt: string;
  scope: string;
  status: "demo" | "verified";
  note?: string;
}

export interface RunRecord {
  id: string;
  kind: "assessment" | "replay";
  createdAt: string;
  scenario: Scenario;
  observed?: { label: string; deltaPct: number; ledgerRef: string };
}
