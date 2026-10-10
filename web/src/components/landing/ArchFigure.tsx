import { useEffect, useMemo, useRef } from "react";
import { frame, GLOW_DEFS, type V3 } from "./iso";

// Fig 04 · Where it runs. One call from the browser into AgentCore; Strands
// agents on top; Step Functions fans out scenario variants; every claim is
// checked against the DynamoDB ledger through Lambda.

interface Block { id: string; x: number; y: number; z: number; w: number; d: number; h: number; label: string; sub: string }

const B: Block[] = [
  { id: "web", x: 0, y: 150, z: 0, w: 70, d: 60, h: 16, label: "WEB APP", sub: "React · SSE" },
  { id: "core", x: 130, y: 110, z: 0, w: 150, d: 130, h: 26, label: "AGENTCORE RUNTIME", sub: "one endpoint" },
  { id: "sfn", x: 340, y: 20, z: 0, w: 120, d: 80, h: 14, label: "STEP FUNCTIONS · MAP", sub: "variants ×3" },
  { id: "lam", x: 340, y: 200, z: 0, w: 60, d: 60, h: 18, label: "LAMBDA", sub: "ledger api" },
  { id: "ddb", x: 440, y: 200, z: 0, w: 70, d: 60, h: 30, label: "DYNAMODB", sub: "provenance" },
];

const AGENT_SPOTS: V3[] = [[150, 128, 26], [190, 128, 26], [230, 128, 26], [170, 180, 26], [215, 180, 26]];

const FLOWS: [V3[], string][] = [
  [[[70, 180, 10], [130, 180, 10]], "f0"],
  [[[280, 140, 12], [310, 140, 12], [310, 60, 8], [340, 60, 8]], "f1"],
  [[[280, 220, 12], [340, 230, 10]], "f2"],
  [[[400, 230, 10], [440, 230, 10]], "f3"],
];

export function ArchFigure() {
  const K = useMemo(() => frame([[0, 0, 0], [520, 0, 0], [0, 270, 0], [520, 270, 0], [200, 150, 90]], 0.05, 1.7), []);
  const ref = useRef<SVGSVGElement>(null);

  const svg = useMemo(() => {
    const { box, TOP, path, P } = K;
    let s = "";
    const order = [...B].sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const b of order) {
      s += `<g data-b="${b.id}">${box(b.x, b.y, b.z, b.w, b.d, b.h)}</g>`;
      if (b.id === "sfn") for (let i = 0; i < 3; i++) s += box(b.x + 10 + i * 36, b.y + 16, b.h, 28, 48, 10 + i * 4);
      if (b.id === "ddb") for (let i = 1; i < 4; i++) s += `<g transform="${K.FRONT(b.x, b.y + b.d, b.z + b.h - i * 7)}"><line class="detail" x1="0" y1="0" x2="${b.w}" y2="0"/></g>`;
      s += `<g transform="${TOP(b.x, b.y, b.z + b.h)}"><rect class="detail" x="5" y="5" width="${b.w - 10}" height="${b.d - 10}" rx="3"/></g>`;
      const [lx, ly] = P(b.x + b.w / 2, b.y + b.d + 14, 0);
      s += `<text class="label hi" x="${lx}" y="${ly}" text-anchor="middle" font-size="9">${b.label}</text>`;
      s += `<text class="label" x="${lx}" y="${ly + 12}" text-anchor="middle" font-size="8">${b.sub}</text>`;
    }
    AGENT_SPOTS.forEach(([x, y, z], i) => {
      s += `<g class="node" data-ag="${i}">${box(x, y, z, 22, 22, 14 + (i === 4 ? 10 : 0))}</g>`;
    });
    const [sx, sy] = P(205, 150, 70);
    s += `<text class="label" x="${sx}" y="${sy}" text-anchor="middle" font-size="8.5">STRANDS AGENTS</text>`;
    let wires = "", pulses = "";
    FLOWS.forEach(([pts, id]) => {
      const d = path(pts);
      wires += `<path class="wire hot" d="${d}"/>`;
      pulses += `<path class="pulse" data-f="${id}" pathLength="1000" d="${d}"/>`;
    });
    return s + wires + pulses;
  }, [K]);

  useEffect(() => {
    let i = 0;
    const id = window.setInterval(() => {
      const el = ref.current;
      if (!el) return;
      const p = el.querySelector(`[data-f="f${i % FLOWS.length}"]`);
      if (p) { p.classList.remove("go"); void (p as SVGElement).getBoundingClientRect(); p.classList.add("go"); }
      el.querySelectorAll("[data-ag]").forEach((n) => n.classList.toggle("hot", Number(n.getAttribute("data-ag")) === i % AGENT_SPOTS.length));
      i++;
    }, 700);
    return () => window.clearInterval(id);
  }, []);

  return (
    <svg ref={ref} viewBox={K.viewBox} className="w-full" role="img" aria-label="Architecture: the web app calls AgentCore Runtime, which hosts Strands agents, fans out variants on Step Functions and checks claims via Lambda against DynamoDB.">
      <defs dangerouslySetInnerHTML={{ __html: GLOW_DEFS }} />
      <g dangerouslySetInnerHTML={{ __html: svg }} />
    </svg>
  );
}
