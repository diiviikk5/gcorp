// Isometric projection kernel, ported from iso-glow / iso-figure
// (Tolga Cohce, MIT · github.com/MrBongoC/ai-iso-skill · iso-glow.vercel.app).
// +x runs down-right, +y down-left, +z up. Paint order is back to front.

const C = Math.cos(Math.PI / 6);
const S = Math.sin(Math.PI / 6);

export type V3 = [number, number, number];

export function kernel(OX: number, OY: number) {
  const P = (x: number, y: number, z: number): [number, number] => [(x - y) * C + OX, (x + y) * S - z + OY];
  const D = (x: number, y: number, z: number): [number, number] => [(x - y) * C, (x + y) * S - z];
  const plane = (O: V3, U: V3, V: V3) => {
    const o = P(...O), u = D(...U), v = D(...V);
    return `matrix(${u[0]} ${u[1]} ${v[0]} ${v[1]} ${o[0]} ${o[1]})`;
  };
  const TOP = (x: number, y: number, z: number) => plane([x, y, z], [1, 0, 0], [0, 1, 0]);
  const FRONT = (x: number, y: number, z: number) => plane([x, y, z], [1, 0, 0], [0, 0, -1]);
  const SIDE = (x: number, y: number, z: number) => plane([x, y, z], [0, -1, 0], [0, 0, -1]);
  const rect = (t: string, w: number, h: number, r = 0, cls = "face") => `<g transform="${t}"><rect class="${cls}" width="${w}" height="${h}" rx="${r}"/></g>`;
  const box = (x: number, y: number, z: number, w: number, d: number, h: number, cls = "") =>
    rect(SIDE(x + w, y + d, z + h), d, h, 0, `face ${cls}`) + rect(FRONT(x, y + d, z + h), w, h, 0, `face ${cls}`) + rect(TOP(x, y, z + h), w, d, 0, `face top ${cls}`);
  const path = (pts: V3[]) => "M" + pts.map((p) => P(...p).map((n) => n.toFixed(2)).join(" ")).join("L");
  const poly = (pts: V3[]) => path(pts) + "Z";
  return { P, D, plane, TOP, FRONT, SIDE, rect, box, path, poly };
}

export function frame(points: V3[], margin = 0.06, aspect = 4 / 3) {
  const d = points.map(([x, y, z]) => [(x - y) * C, (x + y) * S - z]);
  const x0 = Math.min(...d.map((p) => p[0])), x1 = Math.max(...d.map((p) => p[0]));
  const y0 = Math.min(...d.map((p) => p[1])), y1 = Math.max(...d.map((p) => p[1]));
  const m = margin * Math.max(x1 - x0, y1 - y0);
  let w = x1 - x0 + 2 * m, h = y1 - y0 + 2 * m;
  let ox = m - x0, oy = m - y0;
  if (w / h < aspect) { const nw = h * aspect; ox += (nw - w) / 2; w = nw; }
  else { const nh = w / aspect; oy += (nh - h) / 2; h = nh; }
  return { ...kernel(ox, oy), viewBox: `0 0 ${w.toFixed(1)} ${h.toFixed(1)}`, W: w, H: h };
}

export const slits = (a0: number, a1: number, step: number, b0: number, b1: number, vertical = true, cls = "detail") => {
  let s = "";
  for (let a = a0; a <= a1 + 1e-6; a += step)
    s += vertical ? `<line class="${cls}" x1="${a}" y1="${b0}" x2="${a}" y2="${b1}"/>` : `<line class="${cls}" x1="${b0}" y1="${a}" x2="${b1}" y2="${a}"/>`;
  return s;
};

export function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// Shared SVG <defs>: glow filters use userSpaceOnUse so straight lines don't vanish.
export const GLOW_DEFS = `
  <filter id="lg-glow" filterUnits="userSpaceOnUse" x="-2000" y="-2000" width="6000" height="6000"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="lg-soft" filterUnits="userSpaceOnUse" x="-2000" y="-2000" width="6000" height="6000"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="lg-bloom" filterUnits="userSpaceOnUse" x="-2000" y="-2000" width="6000" height="6000"><feGaussianBlur stdDeviation="9"/></filter>
  <filter id="lg-haze" filterUnits="userSpaceOnUse" x="-2000" y="-2000" width="6000" height="6000"><feGaussianBlur stdDeviation="18"/></filter>
`;
