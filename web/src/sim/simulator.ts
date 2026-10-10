import type { Scenario, SimResult, VehicleClass } from "@/lib/types";
import { getCity, zoneCoverage } from "./city";
import { clamp } from "./rng";

// Deterministic grid simulator. NOT an agent: same inputs, same output.
// Estimates direction and rough magnitude only, as a range.

// Fraction of ambient PM2.5 attributable to each controllable source (winter).
// Vehicle classes = L-001 (0.20) × L-002 split.
export const SECTOR_SHARE: Record<VehicleClass, { share: number; refs: string[] }> = {
  trucks: { share: 0.2 * 0.42, refs: ["L-001", "L-002"] },
  twoWheelers: { share: 0.2 * 0.28, refs: ["L-001", "L-002"] },
  cars: { share: 0.2 * 0.18, refs: ["L-001", "L-002"] },
  buses: { share: 0.2 * 0.07, refs: ["L-001", "L-002"] },
  autos: { share: 0.2 * 0.05, refs: ["L-001", "L-002"] },
  construction: { share: 0.07, refs: ["L-004"] },
  industry: { share: 0.11, refs: ["L-005"] },
  wasteBurning: { share: 0.08, refs: ["L-006"] },
};

const SHARE_SPREAD = 0.3; // ± on the apportionment share itself

function num(s: Scenario, k: keyof Scenario["params"], fallback: number) {
  const v = s.params[k]?.value;
  return typeof v === "number" ? v : fallback;
}

export function simulate(scenario: Scenario, round = 1): SimResult {
  const { city, base, unc } = getCity();
  const N = city.size;
  const n = N * N;
  const afterLo = new Float32Array(n);
  const afterHi = new Float32Array(n);
  const before = base;

  const cls = scenario.vehicleClass;
  const share = SECTOR_SHARE[cls].share;
  const targeted = num(scenario, "targetedShare", 1) / 100;
  const reduction = num(scenario, "reductionPct", 100) / 100;
  const compliance = num(scenario, "compliancePct", 70) / 100;
  const leakage = num(scenario, "leakagePct", 0) / 100;
  const days = num(scenario, "durationDays", 30);
  const all = scenario.zoneId === "all";

  const isPoint = cls === "construction" || cls === "industry" || cls === "wasteBurning";
  const inZone = (z: string) => all || z === scenario.zoneId;

  // Distance from each out-of-zone cell to the zone (for spillover).
  const dist = new Float32Array(n).fill(99);
  if (!all) {
    const zoneCells = city.cells.filter((c) => inZone(c.zone));
    for (const c of city.cells) {
      if (inZone(c.zone)) { dist[c.z * N + c.x] = 0; continue; }
      let d = 99;
      for (const zc of zoneCells) d = Math.min(d, Math.abs(zc.x - c.x) + Math.abs(zc.z - c.z));
      dist[c.z * N + c.x] = d;
    }
  }

  const core = share * targeted * reduction * compliance;
  let zb = 0, zlo = 0, zhi = 0, zn = 0, expLo = 0, expHi = 0, spill = 0, spillN = 0, band = 0;

  for (const c of city.cells) {
    const i = c.z * N + c.x;
    const b = before[i];
    const u = unc[i];
    let effect = 0; // fraction of AQI removed (positive) or added (negative)

    if (inZone(c.zone)) {
      const w = isPoint
        ? (cls === "industry" ? (c.kind === "industrial" ? 2.2 : 0.55) : cls === "construction" ? (c.kind === "building" || c.kind === "open" ? 1.2 : 0.6) : 1)
        : 0.45 + 1.1 * c.roadWeight;
      effect = core * w * (1 - leakage);
    } else if (!all && leakage > 0 && !isPoint) {
      const d = dist[i];
      if (d <= 5) effect = -core * leakage * (0.4 + c.roadWeight) * Math.exp(-(d - 1) / 1.6) * 0.9;
    }

    // Spread: apportionment ± SHARE_SPREAD, compliance ± 15%, sensor gap widens it.
    const dLoPts = b * effect * (1 - SHARE_SPREAD) * 0.85; // conservative reduction
    const dHiPts = b * effect * (1 + SHARE_SPREAD) * 1.15; // optimistic reduction
    const sensorPad = u * Math.abs(b * effect) * 0.35 + u * 1.5;
    const optimistic = b - Math.max(dLoPts, dHiPts) - sensorPad;
    const conservative = b - Math.min(dLoPts, dHiPts) + sensorPad;
    afterLo[i] = clamp(optimistic, 20, 500);
    afterHi[i] = clamp(conservative, 20, 500);

    if (inZone(c.zone)) {
      zb += b; zlo += afterLo[i]; zhi += afterHi[i]; zn++;
      expLo += c.population * Math.max(0, b - afterHi[i]);
      expHi += c.population * Math.max(0, b - afterLo[i]);
      band += afterHi[i] - afterLo[i];
    } else if (!all && dist[i] <= 4) {
      spill += (b - (afterLo[i] + afterHi[i]) / 2);
      spillN++;
    }
  }

  const zoneBefore = zb / Math.max(1, zn);
  const zoneAfterLo = zlo / Math.max(1, zn);
  const zoneAfterHi = zhi / Math.max(1, zn);
  const deltaLo = Math.max(0, zoneBefore - zoneAfterHi);
  const deltaHi = Math.max(0, zoneBefore - zoneAfterLo);

  return {
    round,
    fingerprint: scenario.fingerprint,
    before,
    afterLo,
    afterHi,
    uncertainty: unc,
    summary: {
      zoneBefore,
      zoneAfterLo,
      zoneAfterHi,
      deltaLo,
      deltaHi,
      pctLo: (deltaLo / zoneBefore) * 100,
      pctHi: (deltaHi / zoneBefore) * 100,
      exposureLo: (expLo * days) / 100,
      exposureHi: (expHi * days) / 100,
      spillover: spillN ? spill / spillN : 0,
      coverage: all ? "good" : zoneCoverage(scenario.zoneId),
      bandWidth: band / Math.max(1, zn),
    },
  };
}
