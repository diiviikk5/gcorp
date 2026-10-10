import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { frame, GLOW_DEFS, slits, type V3 } from "@/components/landing/iso";
import type { AgentId, RunEvent } from "@/lib/types";
import { ledgerById } from "@/data/ledger";
import { AGENTS } from "@/sim/council";
import { cn } from "@/lib/cn";

// The Chamber: where the council works. Every desk, drawer, machine and stamp
// is driven by the engine's `action` / `verdict` / `sim` events, so what you
// see is what the agents actually did.

type Spot = { x: number; y: number; w: number; d: number; h: number };
const DESK: Record<string, Spot> = {
  compiler: { x: 24, y: 214, w: 52, d: 36, h: 18 },
  engineer: { x: 150, y: 40, w: 56, d: 38, h: 18 },
  epidemiologist: { x: 300, y: 40, w: 56, d: 38, h: 18 },
  economist: { x: 330, y: 214, w: 56, d: 38, h: 18 },
  skeptic: { x: 120, y: 236, w: 56, d: 38, h: 18 },
  writer: { x: 440, y: 290, w: 52, d: 36, h: 18 },
};
const TABLE: Spot = { x: 180, y: 112, w: 150, d: 84, h: 16 };
const CABINET: Spot = { x: 452, y: 70, w: 54, d: 44, h: 104 };
const SIM: Spot = { x: 20, y: 40, w: 84, d: 66, h: 44 };
const STAMP: Spot = { x: 238, y: 312, w: 66, d: 40, h: 22 };
const PLATE = { w: 520, d: 380 };
const DRAWERS = 15; // 3 cols × 5 rows on the cabinet front

const top = (s: Spot): V3 => [s.x + s.w / 2, s.y + s.d / 2, s.h + 8];

function drawerIndex(ref: string) {
  let h = 0;
  for (const c of ref) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % DRAWERS;
}

export interface ChamberProps {
  events: RunEvent[];
  className?: string;
}

export function Chamber({ events, className }: ChamberProps) {
  const K = useMemo(() => frame([[0, 0, 0], [PLATE.w, 0, 0], [0, PLATE.d, 0], [PLATE.w, PLATE.d, 0], [CABINET.x, CABINET.y, CABINET.h + 30], [SIM.x, SIM.y, 90]], 0.04, 1.55), []);

  const scene = useMemo(() => {
    const { box, TOP, FRONT, SIDE, P } = K;
    let s = box(0, 0, 0, PLATE.w, PLATE.d, 8);
    s += `<g transform="${TOP(0, 0, 8)}"><rect class="detail" x="10" y="10" width="${PLATE.w - 20}" height="${PLATE.d - 20}"/>${slits(40, PLATE.w - 40, 40, 14, PLATE.d - 14)}</g>`;
    // simulator machine
    s += box(SIM.x, SIM.y, 8, SIM.w, SIM.d, SIM.h);
    s += `<g transform="${FRONT(SIM.x, SIM.y + SIM.d, 8 + SIM.h)}">${slits(10, SIM.w - 10, 6, 26, SIM.h - 6)}</g>`;
    // table
    s += box(TABLE.x, TABLE.y, 8, TABLE.w, TABLE.d, TABLE.h);
    s += `<g transform="${TOP(TABLE.x, TABLE.y, 8 + TABLE.h)}"><rect class="detail" x="8" y="8" width="${TABLE.w - 16}" height="${TABLE.d - 16}" rx="4"/></g>`;
    // desks
    for (const [, d] of Object.entries(DESK)) {
      s += box(d.x, d.y, 8, d.w, d.d, d.h);
      s += box(d.x + 14, d.y + 6, 8 + d.h, 24, 6, 16); // monitor
    }
    // ledger cabinet with drawers
    s += box(CABINET.x, CABINET.y, 8, CABINET.w, CABINET.d, CABINET.h);
    let drawers = "";
    for (let i = 0; i < DRAWERS; i++) {
      const c = i % 3, r = Math.floor(i / 3);
      drawers += `<rect class="win" data-dr="${i}" x="${5 + c * 16}" y="${8 + r * 19}" width="13" height="15"/>`;
    }
    s += `<g transform="${FRONT(CABINET.x, CABINET.y + CABINET.d, 8 + CABINET.h)}">${drawers}</g>`;
    s += `<g transform="${SIDE(CABINET.x + CABINET.w, CABINET.y + CABINET.d, 8 + CABINET.h)}">${slits(8, CABINET.d - 8, 8, 8, CABINET.h - 8)}</g>`;
    // verifier stamp station
    s += box(STAMP.x, STAMP.y, 8, STAMP.w, STAMP.d, STAMP.h);
    s += box(STAMP.x + 22, STAMP.y + 10, 8 + STAMP.h, 20, 20, 20);
    // labels
    const label = (pt: V3, text: string) => {
      const [x, y] = P(...pt);
      return `<text class="label" x="${x}" y="${y}" text-anchor="middle" font-size="9">${text}</text>`;
    };
    s += label([SIM.x + SIM.w / 2, SIM.y + SIM.d + 26, 0], "SIMULATOR");
    s += label([CABINET.x + CABINET.w / 2, CABINET.y + CABINET.d + 26, 0], "LEDGER");
    s += label([STAMP.x + STAMP.w / 2, STAMP.y + STAMP.d + 24, 0], "VERIFIER");
    for (const [id, d] of Object.entries(DESK)) s += label([d.x + d.w / 2, d.y + d.d + 22, 0], AGENTS[id as AgentId].name.toUpperCase());
    return s;
  }, [K]);

  // Current state from the events so far.
  const st = useMemo(() => {
    let lastAction: Extract<RunEvent, { type: "action" }> | null = null;
    let lastVerdict: Extract<RunEvent, { type: "verdict" }> | null = null;
    let simRound = 0;
    let running = false;
    const opened = new Set<string>();
    const log: Record<string, string[]> = {};
    for (const e of events) {
      if (e.type === "action") {
        lastAction = e;
        if (e.tool === "ledger.lookup") opened.add(e.target);
        (log[e.agent] ??= []).push(describe(e));
      } else if (e.type === "verdict") {
        lastVerdict = e;
        (log.verifier ??= []).push(`${e.status === "ask" ? "[ASK]" : e.status.toUpperCase()} ${e.claimId}`);
      } else if (e.type === "sim") simRound = e.round;
      else if (e.type === "complete") running = false;
      else if (e.type === "stage") running = true;
    }
    const last = events[events.length - 1];
    return { lastAction, lastVerdict, simRound, opened, log, running, lastIsVerdict: last?.type === "verdict", lastT: last?.t ?? 0 };
  }, [events]);

  const a = st.lastAction;
  const active = a?.agent;
  const anchorOf = (agent: string): V3 => (agent === "simulator" ? top(SIM) : agent === "verifier" ? top(STAMP) : DESK[agent] ? top(DESK[agent]) : [TABLE.x + TABLE.w / 2, TABLE.y + TABLE.d + 40, 30]);
  const beam = (() => {
    if (!a) return null;
    const from = anchorOf(a.agent);
    if (a.tool === "ledger.lookup") return { from, to: [CABINET.x + CABINET.w / 2, CABINET.y + CABINET.d, 8 + CABINET.h - 10 - Math.floor(drawerIndex(a.target) / 3) * 19] as V3 };
    if (a.tool === "sim.run" || a.tool === "param.propose") return { from, to: top(SIM) };
    if (a.tool === "claim.submit") return { from, to: top(STAMP) };
    return null;
  })();
  const drawer = a?.tool === "ledger.lookup" ? drawerIndex(a.target) : -1;
  const row = a?.tool === "ledger.lookup" ? ledgerById(a.target) : null;
  const simHot = a?.tool === "sim.run" || a?.tool === "param.propose" || active === "simulator";
  // Keep the stamp up for a beat after the verifier rules, so it can be read.
  const verdict = st.lastVerdict && st.lastT - st.lastVerdict.t < 2200 ? st.lastVerdict : null;
  const stampHot = active === "verifier" || !!verdict;
  const stampPt = K.P(STAMP.x + STAMP.w / 2, STAMP.y + STAMP.d / 2, 8 + STAMP.h + 34);
  const deskTop = (id: string) => DESK[id] && K.TOP(DESK[id].x, DESK[id].y, 8 + DESK[id].h);
  const simScreen = K.FRONT(SIM.x, SIM.y + SIM.d, 8 + SIM.h);

  return (
    <div className={cn("landing flex h-full flex-col !bg-transparent", className)}>
      <div className="relative min-h-0 flex-1">
        <svg viewBox={K.viewBox} className="absolute inset-0 h-full w-full" role="img" aria-label="The council chamber: agent desks, ledger cabinet, simulator and verifier stamp, animated by the run's events.">
          <defs dangerouslySetInnerHTML={{ __html: GLOW_DEFS }} />
          <g dangerouslySetInnerHTML={{ __html: scene }} />

          {/* active desk top in accent */}
          {active && deskTop(active) && (
            <g transform={deskTop(active)!}>
              <rect width={DESK[active].w} height={DESK[active].d} fill="var(--accent)" opacity={0.9} />
            </g>
          )}
          {/* verifier station lit while it checks or stamps */}
          {stampHot && (
            <g transform={K.TOP(STAMP.x, STAMP.y, 8 + STAMP.h)}>
              <rect width={STAMP.w} height={STAMP.d} fill="var(--accent)" opacity={0.9} />
            </g>
          )}
          {/* simulator screen */}
          <g transform={simScreen}>
            <rect x={8} y={5} width={SIM.w - 16} height={16} fill={simHot ? "var(--accent)" : "var(--top)"} stroke="var(--line)" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
            <text x={SIM.w / 2} y={16.5} textAnchor="middle" fontSize={8} className="font-mono" fill={simHot ? "#fff" : "var(--ink)"}>{st.simRound ? `ROUND ${st.simRound}` : "IDLE"}</text>
          </g>
          {/* lit drawer */}
          {drawer >= 0 && (
            <g transform={K.FRONT(CABINET.x, CABINET.y + CABINET.d, 8 + CABINET.h)}>
              <rect x={5 + (drawer % 3) * 16} y={8 + Math.floor(drawer / 3) * 19} width={13} height={15} fill="var(--accent)" />
            </g>
          )}
          {/* beam from the acting agent to what it touches */}
          {beam && (() => {
            const d = K.path([beam.from, [(beam.from[0] + beam.to[0]) / 2, (beam.from[1] + beam.to[1]) / 2, Math.max(beam.from[2], beam.to[2]) + 40], beam.to]);
            return (
              <g key={`${a!.t}-${a!.tool}`}>
                <path d={d} fill="none" stroke="var(--accent)" strokeWidth={1} strokeDasharray="3 4" vectorEffect="non-scaling-stroke" opacity={0.7} />
                <path d={d} className="pulse go" pathLength={1000} />
              </g>
            );
          })()}
          {/* verdict stamp */}
          <AnimatePresence>
            {verdict && (
              <motion.g key={verdict.claimId + verdict.t} initial={{ opacity: 0, scale: 1.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ type: "spring", bounce: 0.35, duration: 0.5 }} style={{ transformOrigin: `${stampPt[0]}px ${stampPt[1]}px` }}>
                <g transform={`translate(${stampPt[0]} ${stampPt[1]}) rotate(-8)`}>
                  <rect x={-58} y={-15} width={116} height={30} fill="var(--top)" stroke={verdict.status === "rejected" ? "var(--accent)" : "var(--line)"} strokeWidth={2} />
                  <text textAnchor="middle" y={5} fontSize={13} className="font-mono" fontWeight={700} letterSpacing="0.12em" fill={verdict.status === "rejected" ? "var(--accent)" : "var(--ink-hi)"}>
                    {verdict.status === "ask" ? "[ASK]" : verdict.status.toUpperCase()}
                  </text>
                </g>
              </motion.g>
            )}
          </AnimatePresence>
        </svg>

        {/* what was just opened in the ledger */}
        <AnimatePresence>
          {row && (
            <motion.div key={row.id + a!.t} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute right-4 top-4 w-[260px] border border-[var(--ink-hi)] bg-[var(--bg)] p-3 font-mono text-[11px] leading-snug">
              <div className="flex justify-between text-[var(--ink)]"><span>DRAWER {row.id}</span><span>{row.status.toUpperCase()}</span></div>
              <div className="mt-1.5 font-sans text-[12.5px] text-[var(--ink-hi)]">{row.label}</div>
              <div className="mt-1 text-[13px] text-[var(--accent)]">{row.value}</div>
              <div className="mt-1 truncate text-[var(--ink)]">{row.source}</div>
            </motion.div>
          )}
        </AnimatePresence>
        {a && (
          <div className="absolute left-4 top-4 font-mono text-[11px] tracking-wide text-[var(--ink)]">
            <span className="text-[var(--accent)]">●</span> {AGENTS[a.agent].name.toUpperCase()} {describe(a).toUpperCase()}
          </div>
        )}
      </div>

      {/* activity strips */}
      <div className="grid shrink-0 grid-cols-4 gap-px border-t border-[var(--edge)] bg-[var(--edge)] xl:grid-cols-8">
        {(["compiler", "simulator", "engineer", "epidemiologist", "economist", "skeptic", "verifier", "writer"] as AgentId[]).map((id) => {
          const items = st.log[id] ?? [];
          return (
            <div key={id} className={cn("min-w-0 bg-[var(--bg)] px-2.5 py-2", active === id && "bg-[var(--accent-dim)]")}>
              <div className={cn("truncate text-[11px] font-medium", active === id ? "text-[var(--accent)]" : "text-[var(--ink-hi)]")}>{AGENTS[id].name}</div>
              <div className="mt-1 space-y-0.5 font-mono text-[10px] leading-tight text-[var(--ink)]">
                {items.slice(-3).map((t, i) => <div key={i} className="truncate">{t}</div>)}
                {items.length === 0 && <div className="text-[var(--detail)]">idle</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function describe(e: Extract<RunEvent, { type: "action" }>) {
  switch (e.tool) {
    case "ledger.lookup": return `opens ${e.target}`;
    case "sim.run": return `runs ${e.target}`;
    case "claim.submit": return `submits ${e.target}`;
    case "verify": return `checks ${e.target}`;
    case "param.propose": return `${e.target} ${e.detail ?? ""}`;
  }
}
