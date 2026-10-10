import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { frame, GLOW_DEFS, seeded, type V3 } from "./iso";

// Fig 01 · Anand Vihar, 23:00. An axonometric city block on the NH-24 corridor.
// Only what is live takes the accent: the reporting sensor, the agent speaking, the wire it
// speaks on. Applying the policy clears the trucks and thins the haze, a little.

const PLATE = { w: 520, d: 400 };
const ROAD = { y0: 210, y1: 252 };
const CROSS = { x0: 330, x1: 364 };
const COUNCIL_Z = 300;
const CENTER: V3 = [262, 200, COUNCIL_Z];

const AGENTS = [
  { id: "engineer", label: "ENGINEER" },
  { id: "epi", label: "EPIDEMIOLOGIST" },
  { id: "econ", label: "ECONOMIST" },
  { id: "skeptic", label: "SKEPTIC" },
  { id: "compiler", label: "COMPILER" },
];

const SENSORS: V3[] = [[306, 196, 10], [384, 262, 10], [120, 262, 10], [470, 196, 10]];


interface Lot { x: number; y: number; w: number; d: number; h: number }

function lots(x0: number, y0: number, x1: number, y1: number, rnd: () => number, tall = 0): Lot[] {
  const out: Lot[] = [];
  let x = x0;
  while (x < x1 - 20) {
    const w = Math.min(x1 - x, 44 + Math.floor(rnd() * 30));
    let y = y0;
    while (y < y1 - 20) {
      const d = Math.min(y1 - y, 40 + Math.floor(rnd() * 30));
      if (rnd() > 0.38) {
        const h = 28 + Math.floor(rnd() * 70) + (rnd() < tall ? 90 : 0);
        out.push({ x: x + 6, y: y + 6, w: w - 16, d: d - 16, h });
      }
      y += d;
    }
    x += w;
  }
  return out;
}

export function HeroFigure({ policy, onTurn, aspect = 1.7 }: { policy: boolean; onTurn?: (i: number) => void; aspect?: number }) {
  const K = useMemo(
    () => frame([[0, 0, 0], [PLATE.w, 0, 0], [0, PLATE.d, 0], [PLATE.w, PLATE.d, 0], [CENTER[0], CENTER[1], COUNCIL_Z + 40], [0, 0, 160]], 0.015, aspect),
    [aspect],
  );
  const svgRef = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const sky = useRef<SVGSVGElement>(null);
  const tilt = useRef({ tx: 0, ty: 0, x: 0, y: 0 });
  const trucks = useRef<(SVGGElement | null)[]>([]);
  const cars = useRef<(SVGGElement | null)[]>([]);
  const [turn, setTurn] = useState(0);

  const ring = useMemo(
    () => AGENTS.map((a, i) => {
      const t = (i / AGENTS.length) * Math.PI * 2 - Math.PI / 2;
      return { ...a, pos: [CENTER[0] + Math.cos(t) * 150, CENTER[1] + Math.sin(t) * 150, COUNCIL_Z] as V3 };
    }),
    [],
  );

  // Static scene, built once as an SVG string.
  const scene = useMemo(() => {
    const { box, TOP, FRONT, SIDE, poly, P } = K;
    const rnd = seeded(42);
    let s = "";
    // plate + sidewalk insets
    s += `<g class="ink" style="--d:0ms">` + box(0, 0, 0, PLATE.w, PLATE.d, 10);
    s += `<g transform="${TOP(0, 0, 10)}">
      <rect class="detail" x="8" y="8" width="${PLATE.w - 16}" height="${PLATE.d - 16}" rx="6"/>
      <rect class="face recess" x="0" y="${ROAD.y0}" width="${PLATE.w}" height="${ROAD.y1 - ROAD.y0}"/>
      <rect class="face recess" x="${CROSS.x0}" y="0" width="${CROSS.x1 - CROSS.x0}" height="${PLATE.d}"/>
      ${Array.from({ length: 26 }, (_, i) => `<line class="detail" x1="${i * 20 + 4}" y1="${(ROAD.y0 + ROAD.y1) / 2}" x2="${i * 20 + 14}" y2="${(ROAD.y0 + ROAD.y1) / 2}"/>`).join("")}
      ${Array.from({ length: 20 }, (_, i) => `<line class="detail" x1="${(CROSS.x0 + CROSS.x1) / 2}" y1="${i * 20 + 4}" x2="${(CROSS.x0 + CROSS.x1) / 2}" y2="${i * 20 + 14}"/>`).join("")}
      ${Array.from({ length: 8 }, (_, i) => `<line class="detail" x1="${CROSS.x0 + 3 + i * 4}" y1="${ROAD.y0 - 10}" x2="${CROSS.x0 + 3 + i * 4}" y2="${ROAD.y0 - 2}"/>`).join("")}
    </g></g>`;

    const building = (b: Lot, wid: number, delay: number) => {
      let g = `<g class="ink" style="--d:${delay}ms">` + box(b.x, b.y, 10, b.w, b.d, b.h);
      const rows = Math.floor((b.h - 8) / 18);
      const fc = Math.floor((b.w - 6) / 14), sc = Math.floor((b.d - 6) / 14);
      let wf = "", ws = "";
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < fc; c++) wf += `<rect class="win" data-w="${wid}" x="${6 + c * 14}" y="${7 + r * 18}" width="6" height="8"/>`;
        for (let c = 0; c < sc; c++) ws += `<rect class="win" data-w="${wid}" x="${6 + c * 14}" y="${7 + r * 18}" width="6" height="8"/>`;
      }
      g += `<g transform="${FRONT(b.x, b.y + b.d, 10 + b.h)}">${wf}</g><g transform="${SIDE(b.x + b.w, b.y + b.d, 10 + b.h)}">${ws}</g>`;
      // roof detail
      if (b.h > 60) g += `<g transform="${TOP(b.x, b.y, 10 + b.h)}"><rect class="detail" x="4" y="4" width="${Math.max(2, b.w - 8)}" height="${Math.max(2, b.d - 8)}"/></g>`;
      return g + "</g>";
    };

    const back = [...lots(16, 16, CROSS.x0 - 8, ROAD.y0 - 12, rnd, 0.12), ...lots(CROSS.x1 + 8, 16, PLATE.w - 14, ROAD.y0 - 12, rnd, 0.3)];
    const front = [...lots(16, ROAD.y1 + 10, CROSS.x0 - 8, PLATE.d - 14, rnd, 0.05), ...lots(CROSS.x1 + 8, ROAD.y1 + 10, PLATE.w - 14, PLATE.d - 14, rnd, 0.1)];
    const order = (a: Lot, b: Lot) => a.x + a.y + a.w / 2 + a.d / 2 - (b.x + b.y + b.w / 2 + b.d / 2);
    back.sort(order);
    front.sort(order);
    let backS = "";
    back.forEach((b, i) => (backS += building(b, i, 250 + i * 55)));
    let frontS = "";
    front.forEach((b, i) => (frontS += building(b, i + 1000, 450 + (back.length + i) * 55)));

    // sensors (pylons + LED)
    let sens = `<g class="ink" style="--d:1500ms">`;
    SENSORS.forEach(([x, y, z], i) => {
      sens += box(x, y, z, 4, 4, 44);
      const [cx, cy] = P(x + 2, y + 2, z + 50);
      sens += `<circle class="halo" data-s="${i}" cx="${cx}" cy="${cy}" r="12"/><circle class="led" data-s="${i}" cx="${cx}" cy="${cy}" r="3.4"/>`;
    });

    // haze: three blurred planes over the block
    const hz = (z: number, inset: number) => poly([[inset, inset, z], [PLATE.w - inset, inset, z], [PLATE.w - inset, PLATE.d - inset, z], [inset, PLATE.d - inset, z]]);
    sens += "</g>";
    const haze = `<g class="ink" style="--d:1900ms">` + [[150, 70]].map(([z, ins], i) => `<path class="haze" data-h="${i}" d="${hz(z, ins)}"/>`).join("") + "</g>";

    // survey annotations: leader line + label
    const note = (pt: V3, dx: number, dy: number, text: string) => {
      const [x, y] = P(...pt);
      const ex = x + dx, ey = y + dy, run = dx < 0 ? -64 : 64;
      return `<circle class="leader-dot" cx="${x}" cy="${y}" r="1.8"/><path class="leader" d="M${x} ${y}L${ex} ${ey}L${ex + run} ${ey}"/>` +
        `<text class="note" x="${ex + (dx < 0 ? run : 0)}" y="${ey - 5}">${text}</text>`;
    };
    const notes = note([PLATE.w, (ROAD.y0 + ROAD.y1) / 2, 10], 30, 44, "NH-24");

    return { plate: s, back: backS, front: frontS, sens, haze, notes };
  }, [K]);

  const council = useMemo(() => {
    const { box, path, P } = K;
    let wires = "";
    let pulses = "";
    ring.forEach((a, i) => {
      const d = path([a.pos, CENTER]);
      wires += `<path class="wire" data-a="${i}" d="${d}"/>`;
      pulses += `<path class="pulse" data-pa="${i}" pathLength="1000" d="${d}"/>`;
    });
    SENSORS.forEach((s, i) => {
      const d = path([CENTER, [s[0] + 2, s[1] + 2, s[2] + 50]]);
      wires += `<path class="wire dash" data-sw="${i}" d="${d}"/>`;
      pulses += `<path class="pulse" data-ps="${i}" pathLength="1000" d="${path([[s[0] + 2, s[1] + 2, s[2] + 50], CENTER])}"/>`;
    });
    // ring outline
    const circ: V3[] = Array.from({ length: 64 }, (_, i) => {
      const t = (i / 63) * Math.PI * 2;
      return [CENTER[0] + Math.cos(t) * 150, CENTER[1] + Math.sin(t) * 150, COUNCIL_Z];
    });
    const ringPath = `<path class="detail" d="${path(circ)}"/>`;
    let nodes = "";
    ring.forEach((a, i) => {
      const [x, y, z] = a.pos;
      nodes += `<g class="node" data-n="${i}">${box(x - 9, y - 9, z - 6, 18, 18, 12)}</g>`;
      const [lx, ly] = P(x, y, z + 22);
      nodes += `<text class="label agent" data-l="${i}" x="${lx}" y="${ly}" text-anchor="middle" font-size="9">${a.label}</text>`;
    });
    const [vx, vy] = P(CENTER[0], CENTER[1], COUNCIL_Z + 34);
    nodes += `<g class="node" data-n="v">${box(CENTER[0] - 13, CENTER[1] - 13, COUNCIL_Z - 8, 26, 26, 18)}</g>`;
    nodes += `<circle class="halo" data-vh cx="${P(...CENTER)[0]}" cy="${P(...CENTER)[1] - 14}" r="34"/>`;
    nodes += `<text class="label agent" data-vl x="${vx}" y="${vy}" text-anchor="middle" font-size="9">VERIFIER</text>`;
    return { wires, pulses, ringPath, nodes };
  }, [K, ring]);

  // Trucks and cars as React-positioned groups.
  const vehicles = useMemo(() => {
    const rnd = seeded(9);
    const tr = Array.from({ length: 6 }, (_, i) => ({ lane: i % 2, x: rnd() * PLATE.w, v: (i % 2 ? -1 : 1) * (18 + rnd() * 14) }));
    const cr = Array.from({ length: 7 }, (_, i) => ({ lane: i % 2, x: rnd() * PLATE.w, v: (i % 2 ? -1 : 1) * (34 + rnd() * 22) }));
    return { tr, cr };
  }, []);
  const truckSvg = useMemo(() => K.box(0, 0, 10, 28, 11, 13) + K.box(28, 1, 10, 8, 9, 10), [K]);
  const carSvg = useMemo(() => K.box(0, 0, 10, 13, 8, 6), [K]);

  // Animation loop: vehicles + window flicker.
  useEffect(() => {
    let raf = 0, last = performance.now(), acc = 0;
    const wins = svgRef.current ? Array.from(svgRef.current.querySelectorAll<SVGRectElement>(".win")) : [];
    const rnd = seeded(5);
    wins.forEach((w) => { if (rnd() < 0.14) w.classList.add("lit", ...(rnd() < 0.45 ? ["dim"] : [])); });
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      acc += dt;
      const move = (arr: { lane: number; x: number; v: number }[], els: (SVGGElement | null)[], len: number) => {
        arr.forEach((t, i) => {
          t.x += t.v * dt;
          if (t.x > PLATE.w + 10) t.x = -len;
          if (t.x < -len - 10) t.x = PLATE.w;
          const y = t.lane ? ROAD.y0 + 24 : ROAD.y0 + 6;
          const [dx, dy] = K.D(t.x, y, 0);
          els[i]?.setAttribute("transform", `translate(${dx.toFixed(1)} ${dy.toFixed(1)})`);
        });
      };
      // pointer parallax: whole drawing tilts a little, the council floats above it
      const tl = tilt.current;
      tl.x += (tl.tx - tl.x) * Math.min(1, dt * 4);
      tl.y += (tl.ty - tl.y) * Math.min(1, dt * 4);
      if (stage.current) stage.current.style.transform = `rotateX(${(-tl.y * 4).toFixed(2)}deg) rotateY(${(tl.x * 6).toFixed(2)}deg)`;
      if (sky.current) sky.current.style.transform = `translate3d(${(tl.x * 14).toFixed(1)}px, ${(tl.y * 8 - 6).toFixed(1)}px, 40px)`;
      move(vehicles.tr, trucks.current, 36);
      move(vehicles.cr, cars.current, 13);
      if (acc > 0.35 && wins.length) {
        acc = 0;
        for (let k = 0; k < 3; k++) {
          const w = wins[Math.floor(Math.random() * wins.length)];
          w.classList.toggle("lit");
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [K, vehicles]);

  // Council turns.
  const fire = useCallback((sel: string) => {
    const el = svgRef.current?.querySelector(sel);
    if (!el) return;
    el.classList.remove("go");
    void (el as SVGElement).getBoundingClientRect();
    el.classList.add("go");
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setTurn((t) => t + 1), 1900);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const a = turn % ring.length;
    svg.querySelectorAll(".node").forEach((n) => n.classList.remove("hot"));
    svg.querySelectorAll(".wire").forEach((w) => w.classList.remove("hot"));
    svg.querySelectorAll(".label").forEach((l) => l.classList.remove("hi"));
    svg.querySelector(`[data-n="${a}"]`)?.classList.add("hot");
    svg.querySelector(`[data-a="${a}"]`)?.classList.add("hot");
    svg.querySelector(`[data-l="${a}"]`)?.classList.add("hi");
    const s = turn % SENSORS.length;
    fire(`[data-ps="${s}"]`);
    svg.querySelectorAll(".led").forEach((l) => l.classList.toggle("hot", l.getAttribute("data-s") === String(s)));
    svg.querySelectorAll("circle.halo[data-s]").forEach((l) => l.classList.toggle("hot", l.getAttribute("data-s") === String(s)));
    const t1 = window.setTimeout(() => fire(`[data-pa="${a}"]`), 380);
    const t2 = window.setTimeout(() => {
      svg.querySelector('[data-n="v"]')?.classList.add("hot");
      svg.querySelector("[data-vh]")?.classList.add("hot");
      svg.querySelector("[data-vl]")?.classList.add("hi");
    }, 1250);
    const t3 = window.setTimeout(() => {
      svg.querySelector('[data-n="v"]')?.classList.remove("hot");
      svg.querySelector("[data-vh]")?.classList.remove("hot");
      svg.querySelector("[data-vl]")?.classList.remove("hi");
    }, 1800);
    onTurn?.(turn);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [turn, ring.length, fire, onTurn]);

  // Policy: trucks leave the corridor, haze thins (honestly, not to zero).
  useEffect(() => {
    trucks.current.forEach((t) => t && (t.style.opacity = policy ? "0" : "1"));
    const svg = svgRef.current;
    svg?.querySelectorAll<SVGPathElement>(".haze").forEach((h, i) => {
      const base = [0.9][i] ?? 0;
      h.style.opacity = String(policy ? base * 0.45 : base);
    });
  }, [policy]);

  const layer = "absolute inset-0 h-full w-full [will-change:transform]";
  return (
    <div
      ref={svgRef}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        tilt.current.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
        tilt.current.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
      }}
      onPointerLeave={() => { tilt.current.tx = 0; tilt.current.ty = 0; }}
      className="drawin relative h-full w-full [perspective:1800px]"
      role="img" aria-label="Isometric city block in Anand Vihar with traffic, air sensors and a council of AI agents above it, wired to the sensors. The night truck ban removes trucks and thins the haze.">
      <div ref={stage} className="absolute inset-0 [transform-style:preserve-3d] [will-change:transform]">
      <svg viewBox={K.viewBox} className={layer} aria-hidden>
        <defs dangerouslySetInnerHTML={{ __html: GLOW_DEFS }} />
        <g dangerouslySetInnerHTML={{ __html: scene.plate + scene.back }} />
      </svg>
      <svg viewBox={K.viewBox} className={layer + " late"} aria-hidden>
        {vehicles.cr.map((_, i) => (
          <g key={`c${i}`} ref={(el) => { cars.current[i] = el; }} dangerouslySetInnerHTML={{ __html: carSvg }} />
        ))}
        {vehicles.tr.map((_, i) => (
          <g key={`t${i}`} className="truck" style={{ transition: "opacity 0.8s ease" }} ref={(el) => { trucks.current[i] = el; }} dangerouslySetInnerHTML={{ __html: truckSvg }} />
        ))}
      </svg>
      <svg viewBox={K.viewBox} className={layer} aria-hidden>
        <defs dangerouslySetInnerHTML={{ __html: GLOW_DEFS }} />
        <g dangerouslySetInnerHTML={{ __html: scene.sens + scene.front + scene.haze }} />
      </svg>
      <svg viewBox={K.viewBox} className={layer + " late"} aria-hidden>
        <g dangerouslySetInnerHTML={{ __html: scene.notes }} />
      </svg>
      <svg ref={sky} viewBox={K.viewBox} className={layer + " late"} aria-hidden>
        <defs dangerouslySetInnerHTML={{ __html: GLOW_DEFS }} />
        <g dangerouslySetInnerHTML={{ __html: council.ringPath + council.wires + council.pulses + council.nodes }} />
      </svg>
      </div>
    </div>
  );
}
