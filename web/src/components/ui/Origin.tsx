import type { Origin } from "@/lib/types";
import { cn } from "@/lib/cn";

const map: Record<Origin, { label: string; cls: string }> = {
  stated: { label: "stated", cls: "text-faint" },
  assumed: { label: "assumed", cls: "text-mute" },
  unknown: { label: "unknown", cls: "text-bad" },
};

export function OriginTag({ origin, className }: { origin: Origin; className?: string }) {
  const m = map[origin];
  return <span className={cn("inline-flex w-[52px] justify-end font-mono text-[10px]", m.cls, className)}>{m.label}</span>;
}
