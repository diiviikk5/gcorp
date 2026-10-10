import type { Origin } from "@/lib/types";
import { cn } from "@/lib/cn";

const map: Record<Origin, { label: string; cls: string }> = {
  stated: { label: "stated", cls: "text-ok bg-ok/10 ring-ok/25" },
  assumed: { label: "assumed", cls: "text-warn bg-warn/10 ring-warn/25" },
  unknown: { label: "unknown", cls: "text-bad bg-bad/10 ring-bad/25" },
};

export function OriginTag({ origin, className }: { origin: Origin; className?: string }) {
  const m = map[origin];
  return <span className={cn("inline-flex h-[18px] items-center rounded px-1.5 font-mono text-[10px] uppercase tracking-wider ring-1 ring-inset", m.cls, className)}>{m.label}</span>;
}
