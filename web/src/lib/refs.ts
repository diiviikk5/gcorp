import { ledgerById } from "@/data/ledger";
import type { ParamKey, Scenario, SimResult } from "./types";
import { fmt } from "./aqi";

export interface RefContext {
  scenario: Scenario;
  sim?: SimResult;
  overrides?: Partial<Record<ParamKey, number | string>>;
}

export interface Resolved {
  kind: "ledger" | "sim" | "param" | "fp" | "missing";
  display: string;
}

export function paramDisplay(scenario: Scenario, key: ParamKey, overrides?: Partial<Record<ParamKey, number | string>>) {
  const p = scenario.params[key];
  if (!p) return "?";
  const v = overrides?.[key] ?? p.value;
  if (v === null || v === undefined) return "unknown";
  if (key === "durationDays" && typeof v === "number") return v >= 60 ? `${Math.round(v / 30)} months` : `${v} days`;
  return p.unit === "%" ? `${fmt(Number(v), Number(v) % 1 ? 1 : 0)}%` : `${v}${p.unit && p.unit !== "days" ? " " + p.unit : ""}`;
}

export function ledgerDisplay(id: string) {
  const row = ledgerById(id);
  if (!row) return id;
  const n = Number(row.value);
  if (row.unit?.startsWith("fraction") && !Number.isNaN(n)) return `${fmt(n * 100)}%`;
  if (row.value.length > 18) return row.label.split(" ").slice(0, 3).join(" ");
  return row.value;
}

export function resolveRef(ref: string, ctx?: RefContext): Resolved {
  if (ref.startsWith("L-")) return { kind: ledgerById(ref) ? "ledger" : "missing", display: ledgerDisplay(ref) };
  if (ref === "fp") return { kind: "fp", display: ctx?.sim?.fingerprint ?? ctx?.scenario.fingerprint ?? "—" };
  if (ref.startsWith("param:") && ctx) return { kind: "param", display: paramDisplay(ctx.scenario, ref.slice(6) as ParamKey, ctx.overrides) };
  if (ref.startsWith("sim:") && ctx?.sim) {
    const s = ctx.sim.summary;
    const k = ref.slice(4);
    const map: Record<string, string> = {
      zoneBefore: fmt(s.zoneBefore),
      zoneAfterRange: `${fmt(s.zoneAfterLo)}–${fmt(s.zoneAfterHi)}`,
      deltaRange: `${fmt(s.deltaLo)}–${fmt(s.deltaHi)}`,
      pctRange: `${fmt(s.pctLo, 1)}–${fmt(s.pctHi, 1)}%`,
      spillover: `${s.spillover < 0 ? "+" : "−"}${fmt(Math.abs(s.spillover), 1)} AQI`,
      deltaLo: fmt(s.deltaLo),
      deltaHi: fmt(s.deltaHi),
    };
    return { kind: "sim", display: map[k] ?? k };
  }
  return { kind: "missing", display: ref };
}

export function splitTokens(text: string): (string | { ref: string })[] {
  const out: (string | { ref: string })[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ ref: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
