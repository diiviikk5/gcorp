import { cn } from "@/lib/cn";

type Tone = "neutral" | "brand" | "ok" | "warn" | "bad" | "violet";

const tones: Record<Tone, string> = {
  neutral: "text-mute ring-black/10",
  brand: "text-fg ring-black/15",
  ok: "text-fg ring-black/15",
  warn: "text-mute ring-black/10",
  bad: "text-bad ring-bad/30",
  violet: "text-fg ring-black/15",
};

export function Badge({ tone = "neutral", dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1.5 rounded-md px-1.5 text-[11px] font-medium ring-1 ring-inset", tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border border-black/10 bg-black/[0.04] px-1 font-mono text-[10.5px] text-mute shadow-[0_1px_0_0_rgb(255_255_255/0.06)_inset]", className)}>
      {children}
    </kbd>
  );
}
