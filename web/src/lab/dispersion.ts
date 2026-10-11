import type { Ward } from "@/components/city/WardView";

// Street Lab: a local dispersion sandbox on real OpenStreetMap geometry.
//
// Physics (deliberately simple, stated openly):
//   emission  along road cells, weighted by road class, with a truck share that is
//             higher on arterials; scaled by a diurnal profile (trucks peak at night)
//   canyon    narrow streets lined by tall buildings trap pollution: 1 + 0.6·min(3, H/W)
//   advection semi-Lagrangian transport by the real hourly wind (Open-Meteo)
//   mixing    a light 3×3 diffusion for urban turbulence
//   removal   ventilation that grows with wind speed and mixing height
//   level     background + local, calibrated so the station cell matches the station
//
// It runs two fields side by side, with and without the policy, under the same
// wind, so the change map is a fair comparison. It is a sandbox for seeing where
// a policy acts, not the decision record; the engine's brief remains that.

export interface LabPolicy {
  trucks: "none" | "night" | "all";
  oddEven: boolean;
  compliance: number; // 0..1
}

export interface LabWeather { windSpeed: number; windDir: number; blh: number; hour: number }

const TRAFFIC = [0.02, 0.015, 0.012, 0.012, 0.015, 0.025, 0.04, 0.06, 0.07, 0.065, 0.055, 0.05, 0.05, 0.05, 0.05, 0.055, 0.06, 0.07, 0.07, 0.06, 0.045, 0.035, 0.03, 0.025];
// Delhi restricts heavy vehicles by day, so trucks run mostly 23:00–07:00 (L-015).
const TRUCKS = [0.08, 0.08, 0.075, 0.07, 0.065, 0.06, 0.05, 0.02, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.015, 0.02, 0.03, 0.05, 0.07, 0.08];

export class Dispersion {
  readonly N: number;
  readonly R: number;
  readonly cell: number;
  height: Float32Array; // building height per cell (0 = open)
  road: Float32Array; // traffic weight per cell
  truck: Float32Array; // truck share of that traffic
  canyon: Float32Array;
  roadName: (string | null)[];
  base: Float32Array; // local concentration, no policy
  pol: Float32Array; // local concentration, with policy
  private tmp: Float32Array;
  scale = 1; // calibration: local units -> µg/m³
  background = 110; // µg/m³ regional + urban background
  smoke = 0; // µg/m³ extra regional smoke on a stubble-burning day (no street policy touches it)
  stationCell = -1;

  constructor(ward: Ward, N = 144) {
    this.N = N;
    this.R = ward.radius;
    this.cell = (2 * this.R) / N;
    const n = N * N;
    this.height = new Float32Array(n);
    this.road = new Float32Array(n);
    this.truck = new Float32Array(n);
    this.canyon = new Float32Array(n).fill(1);
    this.roadName = new Array(n).fill(null);
    this.base = new Float32Array(n);
    this.pol = new Float32Array(n);
    this.tmp = new Float32Array(n);
    this.rasterise(ward);
    if (ward.stations[0]) this.stationCell = this.index(ward.stations[0].p[0], ward.stations[0].p[1]);
  }

  index(x: number, z: number) {
    const ix = Math.floor((x + this.R) / this.cell), iz = Math.floor((z + this.R) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.N || iz >= this.N) return -1;
    return iz * this.N + ix;
  }
  centre(i: number): [number, number] {
    return [((i % this.N) + 0.5) * this.cell - this.R, (Math.floor(i / this.N) + 0.5) * this.cell - this.R];
  }

  private rasterise(w: Ward) {
    const { N, cell } = this;
    // buildings: point-in-polygon per cell centre within each footprint's box
    for (const b of w.buildings) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of b.p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      for (let z = z0; z <= z1; z += cell * 0.5) {
        for (let x = x0; x <= x1; x += cell * 0.5) {
          if (!inside(b.p, x, z)) continue;
          const i = this.index(x, z);
          if (i >= 0) this.height[i] = Math.max(this.height[i], b.h);
        }
      }
    }
    // roads: sample each segment, paint cells within half the width
    for (const r of w.roads) {
      const weight = Math.pow(r.w / 8, 1.3);
      const tf = r.w >= 14 ? 0.4 : r.w >= 11 ? 0.25 : 0.08;
      const half = Math.max(cell * 0.6, r.w / 2);
      for (let k = 0; k < r.p.length - 1; k++) {
        const [ax, az] = r.p[k], [bx, bz] = r.p[k + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const steps = Math.max(1, Math.ceil(len / (cell * 0.5)));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
          const span = Math.ceil(half / cell);
          for (let dz = -span; dz <= span; dz++) {
            for (let dx = -span; dx <= span; dx++) {
              const x = cx + dx * cell, z = cz + dz * cell;
              if (Math.hypot(x - cx, z - cz) > half + cell * 0.5) continue;
              const i = this.index(x, z);
              if (i < 0 || this.height[i] > 0) continue;
              if (weight > this.road[i]) { this.road[i] = weight; this.truck[i] = tf; this.roadName[i] = r.n || null; }
            }
          }
        }
      }
    }
    // canyon factor: mean height of buildings within 3 cells vs the road width
    for (let i = 0; i < N * N; i++) {
      if (!this.road[i]) continue;
      const ix = i % N, iz = Math.floor(i / N);
      let hs = 0, c = 0;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        const x = ix + dx, z = iz + dz;
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const h = this.height[z * N + x];
        if (h > 0) { hs += h; c++; }
      }
      const H = c ? hs / c : 0;
      const W = Math.max(5, this.road[i] ** (1 / 1.3) * 8);
      this.canyon[i] = 1 + 0.6 * Math.min(3, H / W);
    }
  }

  private emission(i: number, hour: number, p: LabPolicy | null) {
    const tr = this.road[i];
    if (!tr) return 0;
    const tf = this.truck[i];
    let cars = (1 - tf) * TRAFFIC[hour] * 24;
    let trucks = tf * TRUCKS[hour] * 24 * 2.4; // a truck emits several cars' worth of PM (L-002)
    if (p) {
      const night = hour >= 23 || hour < 7;
      if (p.trucks === "all" || (p.trucks === "night" && night)) trucks *= 1 - 0.94 * p.compliance; // diesel share in scope (L-009)
      if (p.oddEven) cars *= 1 - 0.5 * 0.65 * p.compliance; // half the plates, minus exemptions (L-016, L-017)
    }
    return tr * (cars + trucks) * this.canyon[i];
  }

  /** Advance both fields by `seconds` of simulated time under the given weather and policy. */
  step(wx: LabWeather, policy: LabPolicy, seconds = 60) {
    const speed = Math.max(0.4, wx.windSpeed / 3.6); // m/s
    const toward = ((wx.windDir + 180) * Math.PI) / 180;
    const ux = Math.sin(toward) * speed; // east
    const uz = -Math.cos(toward) * speed; // south is +z
    // Ventilation grows with wind; a shallow mixing layer concentrates the same
    // emissions into less air (night inversions), bounded to realistic ratios.
    const vent = 0.0007 + 0.0005 * speed;
    const column = Math.pow(600 / Math.min(1500, Math.max(150, wx.blh)), 0.6);
    for (const [field, pol] of [[this.base, null], [this.pol, policy]] as const) {
      this.advect(field, ux * seconds, uz * seconds);
      const { N } = this;
      for (let i = 0; i < N * N; i++) {
        if (this.height[i] > 0) { field[i] = 0; continue; }
        field[i] += this.emission(i, wx.hour, pol) * seconds * 0.02 * column;
        field[i] *= Math.exp(-vent * seconds);
      }
      this.diffuse(field, 0.3);
      this.diffuse(field, 0.3);
    }
  }

  private advect(f: Float32Array, dx: number, dz: number) {
    const { N, cell, tmp } = this;
    const sx = dx / cell, sz = dz / cell;
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const i = iz * N + ix;
        if (this.height[i] > 0) { tmp[i] = 0; continue; }
        const x = ix - sx, z = iz - sz;
        if (x < 0 || z < 0 || x > N - 1 || z > N - 1) { tmp[i] = 0; continue; } // clean air enters upwind
        const x0 = Math.floor(x), z0 = Math.floor(z), fx = x - x0, fz = z - z0;
        const x1 = Math.min(N - 1, x0 + 1), z1 = Math.min(N - 1, z0 + 1);
        const g = (a: number, b: number) => { const j = b * N + a; return this.height[j] > 0 ? f[i] : f[j]; }; // walls reflect
        tmp[i] = (g(x0, z0) * (1 - fx) + g(x1, z0) * fx) * (1 - fz) + (g(x0, z1) * (1 - fx) + g(x1, z1) * fx) * fz;
      }
    }
    f.set(tmp);
  }

  private diffuse(f: Float32Array, a = 0.14) {
    const { N, tmp } = this;
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const i = iz * N + ix;
        if (this.height[i] > 0) { tmp[i] = 0; continue; }
        let s = 0, c = 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = ix + dx, z = iz + dz;
          if (x < 0 || z < 0 || x >= N || z >= N) continue;
          const j = z * N + x;
          if (this.height[j] > 0) continue;
          s += f[j]; c++;
        }
        tmp[i] = c ? f[i] * (1 - a) + (s / c) * a : f[i];
      }
    }
    f.set(tmp);
  }

  /** Mean over open cells within ~100 m of the station: a station samples its neighbourhood. */
  near(field: Float32Array) {
    if (this.stationCell < 0) return 0;
    const N = this.N, i0 = this.stationCell;
    const ix0 = i0 % N, iz0 = Math.floor(i0 / N), r = Math.round(100 / this.cell);
    let s = 0, c = 0;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const x = ix0 + dx, z = iz0 + dz;
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const j = z * N + x;
      if (this.height[j] === 0) { s += field[j]; c++; }
    }
    return c ? s / c : 0;
  }

  /** Scale local increments so the area's mean reads the station's PM2.5 under baseline. */
  calibrate(stationPm: number) {
    const N = this.N;
    let s = 0, c = 0;
    for (let i = 0; i < N * N; i++) if (this.height[i] === 0) { s += this.base[i]; c++; }
    const meanLocal = c ? s / c : 0;
    this.background = stationPm * 0.55;
    this.scale = meanLocal > 0 ? (stationPm - this.background) / meanLocal : 1;
  }

  pm(field: Float32Array, i: number) {
    return this.background + this.smoke + field[i] * this.scale;
  }

  stats() {
    const { N } = this;
    let sb = 0, sp = 0, n = 0, best = { i: -1, gain: 0 };
    for (let i = 0; i < N * N; i++) {
      if (this.height[i] > 0) continue;
      const b = this.pm(this.base, i), p = this.pm(this.pol, i);
      sb += b; sp += p; n++;
      if (this.road[i] && b - p > best.gain && this.roadName[i]) best = { i, gain: b - p };
    }
    const st = this.stationCell >= 0 ? { base: this.background + this.smoke + this.near(this.base) * this.scale, pol: this.background + this.smoke + this.near(this.pol) * this.scale } : null;
    return { meanBase: sb / n, meanPol: sp / n, station: st, bestStreet: best.i >= 0 ? { name: this.roadName[best.i]!, gain: best.gain } : null };
  }
}

function inside(poly: [number, number][], x: number, z: number) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

// CPCB National AQI for PM2.5 (24 h breakpoints).
const BP: [number, number, number, number][] = [[0, 30, 0, 50], [31, 60, 51, 100], [61, 90, 101, 200], [91, 120, 201, 300], [121, 250, 301, 400], [251, 500, 401, 500]];
export function pmToAqi(pm: number) {
  for (const [cl, ch, il, ih] of BP) if (pm <= ch) return il + ((ih - il) * (Math.max(cl, pm) - cl)) / (ch - cl);
  return 500;
}
export function aqiToPm(aqi: number) {
  for (const [cl, ch, il, ih] of BP) if (aqi <= ih) return cl + ((ch - cl) * (Math.max(il, aqi) - il)) / (ih - il);
  return 500;
}
