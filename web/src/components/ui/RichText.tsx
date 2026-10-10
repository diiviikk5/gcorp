import { resolveRef, splitTokens, type RefContext } from "@/lib/refs";
import { cn } from "@/lib/cn";
import { useUi } from "@/store/ui";

const tones = {
  ledger: "text-fg decoration-black/35",
  sim: "text-fg decoration-black/35",
  param: "text-fg decoration-black/20 decoration-dashed",
  fp: "text-mute font-mono decoration-black/20",
  missing: "text-bad decoration-bad/50",
};

// Every number on screen is one of these: clickable, and traced to its source.
export function RefChip({ refId, ctx, runId, className }: { refId: string; ctx?: RefContext; runId?: string; className?: string }) {
  const open = useUi((s) => s.openProvenance);
  const r = resolveRef(refId, ctx);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); open({ ref: refId, runId }); }}
      title={refId.startsWith("L-") ? `Ledger ${refId}` : refId}
      className={cn("-mx-0.5 rounded px-0.5 font-medium tabular underline decoration-dotted underline-offset-[3px] transition-colors hover:bg-black/10 hover:decoration-black", tones[r.kind], className)}
    >
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
