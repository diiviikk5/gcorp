import { AlertTriangle, ArrowRight, Ban, Check, FileJson, Info, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import type { ParamKey, Scenario, StageId } from "@/lib/types";
import type { StageStatus } from "@/store/playback";
import { STAGES } from "@/sim/council";
import { paramDisplay } from "@/lib/refs";
import { cn } from "@/lib/cn";
import { OriginTag } from "../../ui/Origin";
import { RefChip } from "../../ui/RichText";

const ORDER: ParamKey[] = ["vehicleClass", "fuelFilter", "zone", "reductionPct", "targetedShare", "compliancePct", "leakagePct", "durationDays", "startDate", "hours"];

export function ScenarioCard({ scenario, overrides, runId }: { scenario: Scenario; overrides: Partial<Record<ParamKey, number>>; runId: string }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="eyebrow">Policy</div>
        <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-faint"><FileJson className="size-3" /> scenario.json</span>
      </div>
      <blockquote className="mt-2 rounded-lg bg-black/[0.03] px-3 py-2.5 text-[13px] leading-relaxed text-fg ring-1 ring-inset ring-line">“{scenario.text}”</blockquote>

      <div className="mt-3 divide-y divide-line rounded-lg ring-1 ring-inset ring-line">
        {ORDER.map((k) => {
          const p = scenario.params[k];
          const changed = overrides[k] !== undefined;
          return (
            <div key={k} className={cn("flex items-center gap-2 px-3 py-[7px] text-[12px] transition-colors", changed && "bg-brand/[0.06]")}>
              <span className="w-[112px] shrink-0 truncate text-mute">{p.label}</span>
              <span className="min-w-0 flex-1 truncate text-right tabular">
                {changed ? (
                  <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="inline-flex items-center gap-1">
                    <span className="text-faint line-through">{paramDisplay(scenario, k)}</span>
                    <ArrowRight className="size-3 text-brand" />
                    <RefChip refId={`param:${k}`} ctx={{ scenario, overrides }} runId={runId} />
                  </motion.span>
                ) : p.ledgerRef ? (
                  <RefChip refId={`param:${k}`} ctx={{ scenario }} runId={runId} />
                ) : (
                  <span className="text-fg">{paramDisplay(scenario, k)}</span>
                )}
              </span>
              <OriginTag origin={changed ? "assumed" : p.origin} className="shrink-0" />
            </div>
          );
        })}
      </div>

      {scenario.warnings.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {scenario.warnings.map((w, i) => {
            const Icon = w.level === "block" ? Ban : w.level === "warn" ? AlertTriangle : Info;
            return (
              <div key={i} className={cn("flex gap-2 rounded-lg px-2.5 py-2 text-[11.5px] leading-snug ring-1 ring-inset", w.level === "block" ? "bg-bad/[0.06] text-bad ring-bad/20" : w.level === "warn" ? "bg-warn/[0.06] text-warn ring-warn/20" : "bg-black/[0.03] text-mute ring-line")}>
                <Icon className="mt-px size-3.5 shrink-0" />
                <span>{w.text} {w.ledgerRef && <RefChip refId={w.ledgerRef} runId={runId} />}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function StageRail({ stages }: { stages: Record<StageId, StageStatus> }) {
  return (
    <div>
      <div className="eyebrow">Pipeline</div>
      <ol className="relative mt-3 space-y-0.5">
        {STAGES.map((s, i) => {
          const st = stages[s.id];
          return (
            <li key={s.id} className="relative flex gap-3 pb-3">
              {i < STAGES.length - 1 && <span className={cn("absolute left-[11px] top-6 h-[calc(100%-16px)] w-px", st === "done" ? "bg-ok/40" : "bg-line-2")} />}
              <span className={cn("relative z-10 mt-0.5 grid size-[23px] shrink-0 place-items-center rounded-full text-[10px] font-semibold ring-1 ring-inset transition-colors", st === "done" ? "bg-ok/15 text-ok ring-ok/30" : st === "running" ? "bg-brand/15 text-brand ring-brand/40" : "bg-black/[0.03] text-faint ring-line-2")}>
                {st === "done" ? <Check className="size-3" strokeWidth={3} /> : st === "running" ? <Loader2 className="size-3 animate-spin" /> : i + 1}
                {st === "running" && <span className="ping-soft absolute inset-0 rounded-full ring-1 ring-brand/60" />}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[12.5px] font-medium">
                  <span className={st === "idle" ? "text-mute" : "text-fg"}>{s.label}</span>
                  <span className="font-mono text-[10px] font-normal text-faint">{s.artifact}</span>
                </div>
                <div className="text-[11.5px] text-faint">{s.blurb}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
