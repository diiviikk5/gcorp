import type { CompilerWarning, Origin, ParamKey, Scenario, ScenarioParam, VehicleClass } from "@/lib/types";
import { ZONES, zoneById, zoneCoverage } from "./city";
import { fnv1a } from "./rng";

// Policy compiler: constrained extraction, no LLM required.
// Every parameter is marked stated / assumed / unknown. Unknowns are flagged,
// filled with an explicit default only so the simulator can run, and surfaced
// for the planner to confirm.

export const CLASS_LABEL: Record<VehicleClass, string> = {
  trucks: "Goods vehicles (trucks)",
  autos: "Auto-rickshaws (3W)",
  cars: "Private cars",
  twoWheelers: "Two-wheelers",
  buses: "Buses",
  construction: "Construction dust",
  industry: "Industrial units",
  wasteBurning: "Open waste burning",
};

const CLASS_PATTERNS: [VehicleClass, RegExp][] = [
  ["autos", /\b(autos?|auto-?rickshaws?|three-?wheelers?|3w)\b/i],
  ["trucks", /\b(trucks?|lorr(y|ies)|goods vehicles?|hgvs?|hdvs?|heavy vehicles?|freight)\b/i],
  ["cars", /\b(cars?|odd-?even|private vehicles?|four-?wheelers?)\b/i],
  ["twoWheelers", /\b(two-?wheelers?|bikes?|scooters?|motorcycles?|2w)\b/i],
  ["buses", /\b(bus|buses)\b/i],
  ["construction", /\b(construction|demolition|building sites?|dust)\b/i],
  ["industry", /\b(industr(y|ies|ial)|factor(y|ies)|boilers?|furnaces?)\b/i],
  ["wasteBurning", /\b(waste|garbage|landfill|trash|leaf) burning\b|\bburning (of )?(waste|garbage)\b/i],
];

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function p(key: ParamKey, label: string, value: ScenarioParam["value"], origin: Origin, extra: Partial<ScenarioParam> = {}): ScenarioParam {
  return { key, label, value, origin, ...extra };
}

export interface CompileInput {
  text: string;
  zoneId?: string; // chosen in the wizard
  overrides?: Partial<Record<ParamKey, number | string>>;
}

export function compile({ text, zoneId, overrides = {} }: CompileInput): Scenario {
  const t = text.toLowerCase();
  const warnings: CompilerWarning[] = [];

  // --- source class
  let vehicleClass: VehicleClass | null = null;
  for (const [cls, re] of CLASS_PATTERNS) if (re.test(t)) { vehicleClass = cls; break; }
  if (!vehicleClass) {
    warnings.push({ level: "block", text: "Couldn't tell which emission source this policy targets. Name a vehicle class or sector (e.g. trucks, construction dust)." });
    vehicleClass = "trucks";
  }
  const isOddEven = /odd-?even/.test(t);

  // --- fuel filter
  const fuelMatch = t.match(/\b(diesel|petrol|cng|bs-?\s?(iii|iv|3|4)( and older)?|non-?bs-?vi|old(er)?)\b/);
  const fuel = fuelMatch ? fuelMatch[0].replace(/\s+/g, " ") : null;

  // --- zone
  let zone: string | "all" = zoneId ?? "";
  let zoneOrigin: Origin = zoneId ? "stated" : "unknown";
  if (/\b(city-?wide|all of delhi|across delhi|whole city|entire city|delhi-?wide)\b/.test(t) || isOddEven && !zoneId) {
    zone = "all";
    zoneOrigin = "stated";
  } else {
    const named = ZONES.find((z) => t.includes(z.name.toLowerCase()) || t.includes(z.id));
    if (named) { zone = named.id; zoneOrigin = "stated"; }
  }
  if (!zone) {
    zone = "anandvihar";
    warnings.push({ level: "warn", text: "No area stated. Pick a zone before running." });
  }

  // --- reduction
  let reduction = 100;
  let reductionOrigin: Origin = "stated";
  const pct = t.match(/(\d{1,3})\s?%/);
  if (/\bban(ned|s)?\b|\bprohibit|\bbar(red)?\b|\bodd-?even\b|\bshut\b/.test(t)) reduction = 100;
  else if (pct && /(cut|reduc|lower|curb|limit)/.test(t)) reduction = Math.min(100, +pct[1]);
  else if (/(enforce|enforcement|crack ?down|inspect)/.test(t)) { reduction = 100; reductionOrigin = "stated"; }
  else { reduction = 50; reductionOrigin = "unknown"; warnings.push({ level: "warn", text: "Strength of the restriction isn't stated. Assumed a 50% cut in activity." }); }

  // --- targeted share of that source
  let targeted = 100;
  let targetedOrigin: Origin = "assumed";
  let targetedRef: string | undefined;
  let targetedNote = "Whole source class is in scope.";
  if (vehicleClass === "trucks" && (fuel?.includes("diesel") ?? true)) { targeted = 94; targetedRef = "L-009"; targetedNote = "Diesel share of goods vehicles at entry points."; }
  if (vehicleClass === "autos") {
    if (fuel?.includes("diesel")) {
      targeted = 1; targetedRef = "L-008"; targetedNote = "Delhi autos run on CNG.";
      warnings.push({ level: "block", text: "Delhi's auto fleet is already CNG. A diesel-auto ban targets almost no emissions.", ledgerRef: "L-008" });
    }
  }
  if (isOddEven) { targeted = 50 * 0.65; targetedRef = "L-016"; targetedNote = "Half of plates on any day, minus exempted trips (L-017)."; targetedOrigin = "stated"; }
  if (vehicleClass === "construction") { targeted = 45; targetedRef = "L-019"; targetedNote = "Sites not already following dust-control rules."; }

  // --- compliance
  let compliance = 70;
  let complianceOrigin: Origin = "assumed";
  const comp = t.match(/(\d{1,3})\s?% (compliance|enforcement)/);
  if (comp) { compliance = +comp[1]; complianceOrigin = "stated"; }
  else if (/strict(ly)? enforc|camera|anpr/.test(t)) { compliance = 85; complianceOrigin = "assumed"; }

  // --- duration
  let duration: number | null = null;
  const dur = t.match(/(\d+|one|two|three|four|six|twelve)\s*(day|week|month|year)s?/);
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, six: 6, twelve: 12 };
  if (dur) {
    const n = isNaN(+dur[1]) ? words[dur[1]] : +dur[1];
    duration = n * ({ day: 1, week: 7, month: 30, year: 365 } as Record<string, number>)[dur[2]];
  } else if (/fortnight/.test(t)) duration = 14;
  const durationOrigin: Origin = duration ? "stated" : "unknown";
  if (!duration) { duration = 90; warnings.push({ level: "warn", text: "Duration not stated. Assumed 90 days; confirm before running." }); }

  // --- start
  let start = "2026-11-01";
  let startOrigin: Origin = "assumed";
  const mon = MONTHS.findIndex((m) => new RegExp(`\\b(from|in|starting|start|beginning)\\s+(${m}|${m.slice(0, 3)})\\b`).test(t));
  if (mon >= 0) { start = `${mon >= 9 ? 2026 : 2027}-${String(mon + 1).padStart(2, "0")}-01`; startOrigin = "stated"; }
  const yr = t.match(/\b(20\d\d)\b/);
  if (yr && mon >= 0) start = `${yr[1]}-${String(mon + 1).padStart(2, "0")}-01`;
  const startMonth = +start.slice(5, 7);
  if (startMonth === 10 || startMonth === 11) warnings.push({ level: "info", text: "Starts in stubble-burning season. Regional smoke can swamp local gains on peak days.", ledgerRef: "L-007" });

  // --- hours
  let hours = "All day";
  let hoursOrigin: Origin = "assumed";
  if (/night/.test(t)) { hours = "23:00 – 07:00"; hoursOrigin = "stated"; }
  else if (/day-?time|daytime|peak hours/.test(t)) { hours = "07:00 – 23:00"; hoursOrigin = "stated"; }

  if (zone !== "all") {
    const cov = zoneCoverage(zone);
    if (cov !== "good") warnings.push({ level: "warn", text: cov === "none" ? "No usable AQI station in this zone. The range will be very wide." : "Sensor coverage in this zone is thin. Expect a wider range." });
  }

  const params: Record<ParamKey, ScenarioParam> = {
    vehicleClass: p("vehicleClass", "Source", CLASS_LABEL[vehicleClass], vehicleClass ? "stated" : "unknown"),
    fuelFilter: p("fuelFilter", "Fuel / age filter", fuel ?? "Any", fuel ? "stated" : "assumed"),
    zone: p("zone", "Area", zone === "all" ? "All of Delhi" : zoneById(zone)?.name ?? zone, zoneOrigin),
    reductionPct: p("reductionPct", "Activity cut", reduction, reductionOrigin, { unit: "%" }),
    targetedShare: p("targetedShare", "Share of source in scope", Math.round(targeted * 10) / 10, targetedOrigin, { unit: "%", ledgerRef: targetedRef, note: targetedNote }),
    compliancePct: p("compliancePct", "Compliance", compliance, complianceOrigin, { unit: "%", ledgerRef: complianceOrigin === "assumed" ? "L-010" : undefined, note: complianceOrigin === "assumed" ? "Default from the last city-wide restriction." : undefined }),
    leakagePct: p("leakagePct", "Displaced activity", 0, "assumed", { unit: "%", note: "Not modelled unless challenged." }),
    durationDays: p("durationDays", "Duration", duration, durationOrigin, { unit: "days" }),
    startDate: p("startDate", "Start", start, startOrigin),
    hours: p("hours", "Hours", hours, hoursOrigin, { ledgerRef: hoursOrigin === "stated" && hours.startsWith("23") ? "L-015" : undefined }),
    regionalPct: p("regionalPct", "Regional smoke share", ({ 1: 26, 2: 20, 3: 14, 4: 10, 5: 10, 6: 8, 7: 6, 8: 6, 9: 10, 10: 25, 11: 32, 12: 28 } as Record<number, number>)[+start.slice(5, 7)] ?? 25, "assumed", { unit: "%", ledgerRef: "L-032", note: "Transboundary share for the start month." }),
    weather: p("weather", "Weather", /calm|inversion/.test(t) ? "calm" : /windy/.test(t) ? "windy" : "average", /calm|inversion|windy/.test(t) ? "stated" : "assumed", { ledgerRef: "L-024", note: "Mixing regime used by the simulator." }),
  };

  for (const [k, v] of Object.entries(overrides) as [ParamKey, number | string][]) {
    if (params[k]) params[k] = { ...params[k], value: v, origin: "stated", note: "Confirmed by planner." };
  }

  const title = makeTitle(vehicleClass, fuel, zone, params, isOddEven, hoursOrigin === "stated" ? hours : null);
  const fpSource = JSON.stringify({ c: vehicleClass, z: zone, v: Object.values(params).map((x) => x.value) });

  return {
    id: "",
    text,
    title,
    vehicleClass,
    zoneId: zone,
    params,
    warnings,
    fingerprint: fnv1a(fpSource),
  };
}

function makeTitle(cls: VehicleClass, fuel: string | null, zone: string, params: Record<ParamKey, ScenarioParam>, oddEven: boolean, hours: string | null) {
  const where = zone === "all" ? "Delhi" : zoneById(zone)?.name ?? zone;
  const days = params.durationDays.value as number;
  const span = days >= 60 ? `${Math.round(days / 30)} mo` : `${days} d`;
  if (oddEven) return `Odd-even car rationing · ${where} · ${span}`;
  const what = cls === "construction" ? "Construction dust enforcement" :
    cls === "industry" ? "Industrial curbs" :
    cls === "wasteBurning" ? "Waste-burning crackdown" :
    `${hours ? (hours.startsWith("23") ? "night-time " : "daytime ") : ""}${fuel ? fuel + " " : ""}${CLASS_LABEL[cls].split(" (")[0].toLowerCase()} ban`;
  const cap = what.charAt(0).toUpperCase() + what.slice(1);
  return `${cap} · ${where} · ${span}`;
}

export const EXAMPLES = [
  { text: "Ban diesel trucks from entering Anand Vihar at night for six months starting November", tag: "Flagship" },
  { text: "Enforce construction dust rules across Okhla for 3 months", tag: "Sector" },
  { text: "Run odd-even for private cars across Delhi for 15 days in January 2016", tag: "Replay" },
  { text: "Ban diesel autos in ITO for six months", tag: "Gotcha" },
];
