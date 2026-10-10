import { Database, Fingerprint, SlidersHorizontal, Sigma } from "lucide-react";
import { resolveRef, splitTokens, type RefContext } from "@/lib/refs";
import { cn } from "@/lib/cn";
import { useUi } from "@/store/ui";

const icons = { ledger: Database, sim: Sigma, param: SlidersHorizontal, fp: Fingerprint, missing: Database };
const tones = {
  ledger: "text-brand bg-brand/10 ring-brand/25 hover:bg-brand/20",
  sim: "text-a-simulator bg-a-simulator/10 ring-a-simulator/25 hover:bg-a-simulator/20",
  param: "text-warn bg-warn/10 ring-warn/25 hover:bg-warn/20",
  fp: "text-mute bg-white/5 ring-white/10 hover:bg-white/10 font-mono",
  missing: "text-bad bg-bad/10 ring-bad/25",
};

// Every number on screen is one of these: clickable, and traced to its source.
export function RefChip({ refId, ctx, runId, className }: { refId: string; ctx?: RefContext; runId?: string; className?: string }) {
  const open = useUi((s) => s.openProvenance);
  const r = resolveRef(refId, ctx);
  const Icon = icons[r.kind];
  return (
    <button
      onClick={(e) => { e.stopPropagation(); open({ ref: refId, runId }); }}
      title={refId.startsWith("L-") ? `Ledger ${refId}` : refId}
      className={cn("mx-0.5 inline-flex translate-y-[-1px] items-center gap-1 rounded-[5px] px-1.5 py-px align-middle text-[0.86em] font-medium tabular ring-1 ring-inset transition-colors", tones[r.kind], className)}
    >
      <Icon className="size-[0.9em] opacity-70" strokeWidth={2.2} />
      {r.display}
    </button>
  );
}

export function RichText({ text, ctx, runId, className }: { text: string; ctx?: RefContext; runId?: string; className?: string }) {
  return (
    <span className={className}>
      {splitTokens(text).map((p, i) => (typeof p === "string" ? <span key={i}>{p}</span> : <RefChip key={i} refId={p.ref} ctx={ctx} runId={runId} />))}
    </span>
  );
}
