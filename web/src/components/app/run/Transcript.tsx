import { AnimatePresence, motion } from "motion/react";
import { CircleHelp, CircleX, CornerDownRight, RefreshCw, ShieldCheck, Sigma } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentId, Claim, RunEvent } from "@/lib/types";
import type { RefContext } from "@/lib/refs";
import { AGENTS } from "@/sim/council";
import { cn } from "@/lib/cn";
import { Badge } from "../../ui/Badge";
import { RichText } from "../../ui/RichText";
import { Segmented } from "../../ui/Segmented";

const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function AgentAvatar({ id, active, size = 28 }: { id: AgentId; active?: boolean; size?: number }) {
  const a = AGENTS[id];
  return (
    <span
      className={cn("relative grid shrink-0 place-items-center rounded-lg font-mono text-[10px] font-semibold transition-all", active ? "scale-105" : "")}
      style={{ width: size, height: size, color: a.color, background: `color-mix(in oklab, ${a.color} 14%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${a.color} 35%, transparent)${active ? `, 0 0 18px -2px ${a.color}` : ""}` }}
      title={`${a.name} · ${a.model}`}
    >
      {a.short}
      {active && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-s1" style={{ background: a.color }} />}
    </span>
  );
}

const verdictUi = {
  accepted: { icon: ShieldCheck, tone: "ok" as const, label: "Accepted" },
  rejected: { icon: CircleX, tone: "bad" as const, label: "Rejected" },
  ask: { icon: CircleHelp, tone: "warn" as const, label: "[ASK]" },
  pending: { icon: ShieldCheck, tone: "neutral" as const, label: "Checking" },
};

type Filter = "all" | "claims" | "ask";

export function Transcript({ events, claims, ctx, runId, activeAgent, complete }: { events: RunEvent[]; claims: Record<string, Claim>; ctx: RefContext; runId: string; activeAgent: AgentId | null; complete: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const scroller = useRef<HTMLDivElement>(null);
  const verdicts = useMemo(() => {
    const m: Record<string, Extract<RunEvent, { type: "verdict" }>> = {};
    for (const e of events) if (e.type === "verdict") m[e.claimId] = e;
    return m;
  }, [events]);
  const claimList = Object.values(claims);
  const counts = {
    accepted: claimList.filter((c) => c.status === "accepted").length,
    rejected: claimList.filter((c) => c.status === "rejected").length,
    ask: claimList.filter((c) => c.status === "ask").length,
  };

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [events.length]);

  const visible = events.filter((e) => {
    if (e.type === "stage" || e.type === "complete") return false;
    if (filter === "claims") return (e.type === "message" && !!e.claimId) || e.type === "param";
    if (filter === "ask") return e.type === "message" && e.claimId && claims[e.claimId]?.status === "ask";
    return e.type !== "verdict";
  });

  const typingAgent = !complete && activeAgent && activeAgent !== "verifier" ? activeAgent : null;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-4 pb-3 pt-3.5">
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-medium">Council</div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <Badge tone="ok">{counts.accepted} accepted</Badge>
            <Badge tone="bad">{counts.rejected} rejected</Badge>
            <Badge tone="warn">{counts.ask} ask</Badge>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-1.5">
          {(["compiler", "simulator", "engineer", "epidemiologist", "economist", "skeptic", "verifier", "writer"] as AgentId[]).map((id) => (
            <AgentAvatar key={id} id={id} active={activeAgent === id} size={26} />
          ))}
        </div>
        <Segmented
          className="mt-3"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "Debate" },
            { value: "claims", label: "Claims" },
            { value: "ask", label: "Open questions" },
          ]}
        />
      </div>

      <div ref={scroller} className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
        {visible.length === 0 && (
          <div className="px-2 py-10 text-center text-[12.5px] text-faint">{filter === "ask" ? "No open questions yet." : "Waiting for the council…"}</div>
        )}
        <AnimatePresence initial={false}>
          {visible.map((e) => {
            if (e.type === "param") {
              return (
                <motion.div key={`p-${e.key}-${e.t}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mx-1 my-2 flex items-center gap-2 rounded-lg border border-dashed border-brand/30 bg-brand/[0.05] px-3 py-2 text-[11.5px] text-brand">
                  <RefreshCw className="size-3.5" />
                  <span>Input changed by accepted objection: <span className="font-medium">{ctx.scenario.params[e.key].label.toLowerCase()}</span> {e.from}% → {e.to}%. Re-simulating.</span>
                </motion.div>
              );
            }
            if (e.type === "sim") {
              return (
                <motion.div key={`s-${e.round}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-1 my-2 flex items-center gap-2 px-2 text-[11px] text-faint">
                  <Sigma className="size-3.5 text-a-simulator" /> Simulator round {e.round} · results.json written
                  <span className="h-px flex-1 bg-line" />
                </motion.div>
              );
            }
            if (e.type !== "message") return null;
            const a = AGENTS[e.agent];
            const claim = e.claimId ? claims[e.claimId] : undefined;
            const v = e.claimId ? verdicts[e.claimId] : undefined;
            const st = claim?.status ?? "pending";
            const vu = verdictUi[st];
            return (
              <motion.div
                key={e.id}
                layout="position"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", bounce: 0, duration: 0.4 }}
                className={cn("group rounded-xl px-2.5 py-2.5 transition-colors", st === "rejected" ? "bg-bad/[0.04]" : "hover:bg-white/[0.02]")}
              >
                <div className="flex gap-2.5">
                  <AgentAvatar id={e.agent} size={26} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[12.5px] font-medium" style={{ color: a.color }}>{a.name}</span>
                      <span className="truncate text-[10.5px] text-faint">{a.model}</span>
                      <span className="ml-auto font-mono text-[10px] text-faint">{mmss(e.t)}</span>
                    </div>
                    <div className={cn("mt-0.5 text-[12.5px] leading-[1.6] text-fg/90", st === "rejected" && "text-mute line-through decoration-bad/60")}>
                      <RichText text={e.text} ctx={ctx} runId={runId} />
                    </div>
                    {claim && (
                      <div className="mt-2 flex items-start gap-2">
                        <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-faint" />
                        {v ? (
                          <motion.div initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className={cn("min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-[11.5px] leading-snug ring-1 ring-inset", st === "accepted" ? "bg-ok/[0.06] ring-ok/20" : st === "rejected" ? "bg-bad/[0.08] ring-bad/25" : "bg-warn/[0.06] ring-warn/20")}>
                            <div className="mb-0.5 flex items-center gap-1.5">
                              <vu.icon className={cn("size-3.5", st === "accepted" ? "text-ok" : st === "rejected" ? "text-bad" : "text-warn")} />
                              <span className={cn("font-semibold", st === "accepted" ? "text-ok" : st === "rejected" ? "text-bad" : "text-warn")}>Verifier · {vu.label}</span>
                            </div>
                            <RichText text={v.reason} ctx={ctx} runId={runId} className="text-mute" />
                          </motion.div>
                        ) : (
                          <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11.5px] text-faint ring-1 ring-inset ring-line">
                            <span className="shimmer h-2 w-16 rounded" /> Verifier checking sources…
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {typingAgent && (
          <div className="flex items-center gap-2.5 px-2.5 py-2 text-[11.5px] text-faint">
            <AgentAvatar id={typingAgent} size={22} active />
            <span>{AGENTS[typingAgent].name} is thinking</span>
            <span className="flex gap-0.5">
              {[0, 1, 2].map((i) => <span key={i} className="size-1 animate-bounce rounded-full bg-faint" style={{ animationDelay: `${i * 120}ms` }} />)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
