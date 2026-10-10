import { cn } from "@/lib/cn";

type Tone = "neutral" | "brand" | "ok" | "warn" | "bad" | "violet";

const tones: Record<Tone, string> = {
  neutral: "bg-white/[0.05] text-mute ring-white/10",
  brand: "bg-brand/10 text-brand ring-brand/25",
  ok: "bg-ok/10 text-ok ring-ok/25",
  warn: "bg-warn/10 text-warn ring-warn/25",
  bad: "bg-bad/10 text-bad ring-bad/25",
  violet: "bg-a-skeptic/10 text-a-skeptic ring-a-skeptic/25",
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
    <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border border-white/10 bg-white/[0.04] px-1 font-mono text-[10.5px] text-mute shadow-[0_1px_0_0_rgb(255_255_255/0.06)_inset]", className)}>
      {children}
    </kbd>
  );
}
