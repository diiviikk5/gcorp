import { useEffect, useMemo, useRef, useState } from "react";
import { frame, GLOW_DEFS, slits } from "./iso";

// Fig 02 · The pipeline. Five stages on one rail; the active one lights and a
// pulse carries its artifact to the next.

export const PIPE = [
  { id: "scope", label: "SCOPE", file: "scenario.json" },
  { id: "simulate", label: "SIMULATE", file: "results.json" },
  { id: "challenge", label: "CHALLENGE", file: "objections.md" },
  { id: "verify", label: "VERIFY", file: "claims.json" },
  { id: "decide", label: "DECIDE", file: "brief.md" },
];

const W = 92, D = 92, GAP = 34;

export function PipelineFigure({ active, onPick }: { active: number; onPick?: (i: number) => void }) {
  const K = useMemo(() => frame([[0, -10, 0], [PIPE.length * (W + GAP), -10, 0], [0, D + 30, 0], [PIPE.length * (W + GAP), D + 30, 0], [0, 0, 90]], 0.03, 2.1), []);
  const ref = useRef<SVGSVGElement>(null);
  const [, force] = useState(0);

  const parts = useMemo(() => {
    const { box, TOP, FRONT, path, P } = K;
    let rail = box(-14, -6, 0, PIPE.length * (W + GAP) - GAP + 28, D + 12, 6);
    rail += `<g transform="${TOP(-14, -6, 6)}">${slits(10, PIPE.length * (W + GAP) - GAP, 14, 4, D + 8)}</g>`;
    const stages = PIPE.map((s, i) => {
      const x = i * (W + GAP);
      const h = 34 + (i === 3 ? 14 : 0);
      let g = box(x, 0, 6, W, D, h);
      g += `<g transform="${FRONT(x, D, 6 + h)}"><rect class="win" data-st="${i}" x="8" y="8" width="${W - 16}" height="${h - 18}" rx="2"/></g>`;
      g += `<g transform="${TOP(x, 0, 6 + h)}"><rect class="detail" x="8" y="8" width="${W - 16}" height="${D - 16}" rx="3"/></g>`;
      const [lx, ly] = P(x + W / 2, D + 26, 0);
      g += `<text class="label" data-sl="${i}" x="${lx}" y="${ly}" text-anchor="middle" font-size="10">${s.label}</text>`;
      return g;
    }).join("");
    let wires = "";
    let pulses = "";
    for (let i = 0; i < PIPE.length - 1; i++) {
      const x0 = i * (W + GAP) + W, x1 = (i + 1) * (W + GAP);
      const d = path([[x0, D / 2, 24], [x1, D / 2, 24]]);
      wires += `<path class="wire" data-pw="${i}" d="${d}"/>`;
      pulses += `<path class="pulse" data-pp="${i}" pathLength="1000" d="${d}"/>`;
    }
    return { rail, stages, wires, pulses };
  }, [K]);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    svg.querySelectorAll("[data-st]").forEach((e) => e.classList.toggle("lit", Number(e.getAttribute("data-st")) <= active));
    svg.querySelectorAll("[data-st]").forEach((e) => e.classList.toggle("dim", Number(e.getAttribute("data-st")) < active));
    svg.querySelectorAll("[data-sl]").forEach((e) => e.classList.toggle("hi", Number(e.getAttribute("data-sl")) === active));
    svg.querySelectorAll("[data-pw]").forEach((e) => e.classList.toggle("hot", Number(e.getAttribute("data-pw")) < active));
    const p = svg.querySelector(`[data-pp="${active - 1}"]`);
    if (p) { p.classList.remove("go"); void (p as SVGElement).getBoundingClientRect(); p.classList.add("go"); }
    force((n) => n + 1);
  }, [active]);

  return (
    <svg ref={ref} viewBox={K.viewBox} className="w-full" role="img" aria-label="Five pipeline stages in a row: scope, simulate, challenge, verify, decide. The active stage lights up.">
      <defs dangerouslySetInnerHTML={{ __html: GLOW_DEFS }} />
      <g dangerouslySetInnerHTML={{ __html: parts.rail + parts.wires + parts.stages + parts.pulses }} />
      {PIPE.map((_, i) => {
        const [x, y] = K.P(i * (W + GAP) + W / 2, D / 2, 40);
        return <circle key={i} cx={x} cy={y} r={44} fill="transparent" className="cursor-pointer" onClick={() => onPick?.(i)} />;
      })}
    </svg>
  );
}
