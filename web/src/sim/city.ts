import type { Cell, CellKind, City, Station, Zone } from "@/lib/types";
import { clamp, mulberry32 } from "./rng";

// A stylised, procedurally generated Delhi. Zone positions follow real relative
// geography (Yamuna to the east, Anand Vihar across it, Dwarka south-west),
// but the grid is illustrative, not a GIS layer.

export const GRID = 30;

export const ZONES: Zone[] = [
  { id: "narela", name: "Narela", district: "North", cx: 8, cz: 2, character: "industrial", schools: 38, hospitals: 4, populationK: 410 },
  { id: "rohini", name: "Rohini", district: "North West", cx: 4, cz: 7, character: "suburban", schools: 112, hospitals: 14, populationK: 860 },
  { id: "jahangirpuri", name: "Jahangirpuri", district: "North", cx: 12, cz: 5, character: "dense", schools: 64, hospitals: 6, populationK: 540 },
  { id: "shahdara", name: "Shahdara", district: "Shahdara", cx: 26, cz: 6, character: "dense", schools: 88, hospitals: 9, populationK: 720 },
  { id: "wazirpur", name: "Wazirpur", district: "North West", cx: 10, cz: 10, character: "industrial", schools: 41, hospitals: 5, populationK: 380 },
  { id: "mundka", name: "Mundka", district: "West", cx: 2, cz: 14, character: "industrial", schools: 29, hospitals: 3, populationK: 300 },
  { id: "punjabibagh", name: "Punjabi Bagh", district: "West", cx: 8, cz: 15, character: "mixed", schools: 70, hospitals: 11, populationK: 520 },
  { id: "ito", name: "ITO", district: "Central", cx: 17, cz: 12, character: "transit", schools: 34, hospitals: 12, populationK: 260 },
  { id: "anandvihar", name: "Anand Vihar", district: "East", cx: 26, cz: 14, character: "transit", schools: 57, hospitals: 7, populationK: 610 },
  { id: "lodhi", name: "Lodhi Road", district: "New Delhi", cx: 16, cz: 18, character: "green", schools: 22, hospitals: 8, populationK: 140 },
  { id: "rkpuram", name: "R K Puram", district: "South West", cx: 11, cz: 21, character: "mixed", schools: 61, hospitals: 9, populationK: 450 },
  { id: "dwarka", name: "Dwarka", district: "South West", cx: 3, cz: 23, character: "suburban", schools: 96, hospitals: 10, populationK: 690 },
  { id: "okhla", name: "Okhla", district: "South East", cx: 20, cz: 25, character: "industrial", schools: 46, hospitals: 6, populationK: 480 },
];

const STATION_DEFS: { id: string; name: string; zone: string; dx: number; dz: number }[] = [
  { id: "S-AV", name: "Anand Vihar", zone: "anandvihar", dx: 0, dz: 0 },
  { id: "S-VV", name: "Vivek Vihar", zone: "shahdara", dx: 0, dz: 2 },
  { id: "S-ITO", name: "ITO", zone: "ito", dx: 0, dz: 0 },
  { id: "S-PB", name: "Punjabi Bagh", zone: "punjabibagh", dx: 1, dz: -1 },
  { id: "S-RKP", name: "R K Puram", zone: "rkpuram", dx: 0, dz: 0 },
  { id: "S-WZ", name: "Wazirpur", zone: "wazirpur", dx: 0, dz: 0 },
  { id: "S-JP", name: "Jahangirpuri", zone: "jahangirpuri", dx: 0, dz: 1 },
  { id: "S-RH", name: "Rohini", zone: "rohini", dx: 1, dz: 0 },
  { id: "S-DW", name: "Dwarka Sec-8", zone: "dwarka", dx: 1, dz: -1 },
  { id: "S-OK", name: "Okhla Phase-2", zone: "okhla", dx: -1, dz: 0 },
  { id: "S-LR", name: "Lodhi Road", zone: "lodhi", dx: 0, dz: 0 },
  // Mundka and Narela intentionally have no usable station in the demo window.
];

export const riverX = (z: number) => 21.5 + 1.6 * Math.sin(z / 4.6) + (z > 20 ? (z - 20) * 0.25 : 0);

function nearestZone(x: number, z: number): string {
  let best = ZONES[0].id;
  let bd = Infinity;
  const rx = riverX(z);
  for (const zn of ZONES) {
    // The river is a hard boundary: east-bank zones only claim east-bank cells.
    const eastZone = zn.cx > riverX(zn.cz);
    if (eastZone !== x > rx) continue;
    const d = (zn.cx - x) ** 2 + (zn.cz - z) ** 2 * 1.1;
    if (d < bd) {
      bd = d;
      best = zn.id;
    }
  }
  return best;
}

export function buildCity(seed = 11): City {
  const rnd = mulberry32(seed);
  const N = GRID;
  const cells: Cell[] = [];
  const zoneById = Object.fromEntries(ZONES.map((z) => [z.id, z]));

  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const zone = nearestZone(x, z);
      const ch = zoneById[zone].character;
      const rx = riverX(z);
      let kind: CellKind = "building";

      const onRiver = Math.abs(x + 0.5 - rx) < 1.05;
      const ring = (x === 7 || x === 18) && z >= 7 && z <= 21 || (z === 7 || z === 21) && x >= 7 && x <= 18;
      const nh = z === 13 && x >= 15; // NH-24 corridor into Anand Vihar
      const outer = x === 1 && z > 3 && z < 27 || z === 27 && x > 1 && x < 20;
      const grid = x % 5 === 3 || z % 5 === 2;
      const ridge = x >= 12 && x <= 13 && z >= 9 && z <= 15;
      const lodhiPark = x >= 14 && x <= 16 && z >= 17 && z <= 19;

      if (onRiver) kind = nh ? "arterial" : "river";
      else if (ring || nh || outer) kind = "arterial";
      else if (grid) kind = "road";
      else if (ridge || lodhiPark) kind = "park";
      else if (ch === "industrial" && rnd() < 0.72) kind = "industrial";
      else if (ch === "green" && rnd() < 0.45) kind = "park";
      else if (ch === "suburban" && rnd() < 0.16) kind = "park";
      else if (rnd() < (ch === "transit" ? 0.1 : 0.2)) kind = "open";
      else if (rnd() < 0.05) kind = "park";

      let height = 0;
      if (kind === "building") {
        const r = rnd();
        height =
          ch === "transit" ? 0.7 + r * 1.9 :
          ch === "dense" ? 0.7 + r * 1.5 :
          ch === "mixed" ? 0.6 + r * 1.4 :
          ch === "suburban" ? 0.45 + r * 1.1 :
          ch === "green" ? 0.4 + r * 0.6 : 0.5 + r * 0.8;
        if (rnd() < 0.04) height += 1.8; // occasional tower
      } else if (kind === "industrial") {
        height = 0.35 + rnd() * 0.45;
      }

      const roadWeight = kind === "arterial" ? 1 : kind === "road" ? 0.55 : 0;
      const population =
        kind === "building" ? height * (ch === "transit" ? 0.7 : 1) :
        kind === "industrial" ? 0.12 : 0;
      cells.push({ x, z, kind, zone, height, roadWeight, population });
    }
  }

  // Diffuse road weight so cells beside busy roads carry traffic exposure too.
  const rw = cells.map((c) => c.roadWeight);
  for (let pass = 0; pass < 2; pass++) {
    const next = rw.slice();
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        let s = 0, n = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, zz = z + dz;
            if (xx < 0 || zz < 0 || xx >= N || zz >= N) continue;
            s += rw[zz * N + xx];
            n++;
          }
        }
        next[z * N + x] = Math.max(rw[z * N + x], (s / n) * 0.9);
      }
    }
    for (let i = 0; i < rw.length; i++) rw[i] = next[i];
  }
  cells.forEach((c, i) => (c.roadWeight = clamp(rw[i], 0, 1)));

  const stations: Station[] = STATION_DEFS.map((s) => {
    const zn = zoneById[s.zone];
    return { id: s.id, name: s.name, x: zn.cx + s.dx, z: zn.cz + s.dz, aqi: 0, ledgerRef: `L-${s.id}` };
  });

  return { size: N, cells, zones: ZONES, stations };
}

// Baseline (pre-policy) AQI field: a winter "very poor" day.
export function baselineField(city: City, seed = 7): Float32Array {
  const N = city.size;
  const rnd = mulberry32(seed);
  const raw = new Float32Array(N * N);
  for (const c of city.cells) {
    const i = c.z * N + c.x;
    let v = 268;
    v += 70 * c.roadWeight;
    if (c.kind === "industrial") v += 55;
    if (c.kind === "park") v -= 28;
    if (c.kind === "river") v -= 10;
    v += (c.x / N) * 45; // east is worse (border traffic, landfill)
    v += (1 - c.z / N) * 25; // north-west industrial belt
    v += (rnd() - 0.5) * 40;
    raw[i] = v;
  }
  // smooth
  const out = new Float32Array(N * N);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      let s = 0, w = 0;
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= N || zz >= N) continue;
          const k = 1 / (1 + dx * dx + dz * dz);
          s += raw[zz * N + xx] * k;
          w += k;
        }
      }
      out[z * N + x] = clamp(s / w, 150, 490);
    }
  }
  for (const st of city.stations) st.aqi = Math.round(out[st.z * N + st.x] + 6);
  return out;
}

// 0 = sensor right here, 1 = no sensor within reach.
export function uncertaintyField(city: City): Float32Array {
  const N = city.size;
  const u = new Float32Array(N * N);
  for (const c of city.cells) {
    let d = Infinity;
    for (const s of city.stations) d = Math.min(d, Math.hypot(s.x - c.x, s.z - c.z));
    u[c.z * N + c.x] = clamp((d - 1.5) / 8, 0, 1);
  }
  return u;
}

let cached: { city: City; base: Float32Array; unc: Float32Array } | null = null;
export function getCity() {
  if (!cached) {
    const city = buildCity();
    const base = baselineField(city);
    const unc = uncertaintyField(city);
    cached = { city, base, unc };
  }
  return cached;
}

export function zoneById(id: string) {
  return ZONES.find((z) => z.id === id);
}

export function zoneCoverage(zoneId: string): "good" | "thin" | "none" {
  const { city, unc } = getCity();
  let s = 0, n = 0;
  for (const c of city.cells) if (c.zone === zoneId) { s += unc[c.z * city.size + c.x]; n++; }
  const m = n ? s / n : 1;
  return m < 0.28 ? "good" : m < 0.55 ? "thin" : "none";
}

export function zoneBaseline(zoneId: string): number {
  const { city, base } = getCity();
  let s = 0, n = 0;
  for (const c of city.cells) if (c.zone === zoneId || zoneId === "all") { s += base[c.z * city.size + c.x]; n++; }
  return n ? s / n : 0;
}
