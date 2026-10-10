import { aqiBand, fmt } from "@/lib/aqi";
import { cn } from "@/lib/cn";

export function AqiPill({ value, className, showLabel = true }: { value: number; className?: string; showLabel?: boolean }) {
  const b = aqiBand(value);
  return (
    <span className={cn("inline-flex h-5 items-center gap-1.5 rounded-md bg-black/[0.04] px-1.5 text-[11px] font-medium tabular ring-1 ring-inset ring-black/10", className)}>
      <span className="size-1.5 rounded-full" style={{ background: b.color }} />
      <span className="text-fg">{fmt(value)}</span>
      {showLabel && <span className="text-mute">{b.label}</span>}
    </span>
  );
}

export function AqiScale({ className }: { className?: string }) {
  const stops = ["#4fb26b", "#a3c853", "#e9cf47", "#f29c33", "#e8483a", "#a8233a"];
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="h-1.5 w-32 rounded-full" style={{ background: `linear-gradient(90deg, ${stops.join(",")})` }} />
      <div className="flex w-32 justify-between font-mono text-[9.5px] text-faint">
        <span>0</span>
        <span>200</span>
        <span>500</span>
      </div>
    </div>
  );
}

export function Sparkline({ values, className, color = "currentColor" }: { values: number[]; className?: string; color?: string }) {
  const w = 84, h = 22;
  const min = Math.min(...values), max = Math.max(...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - ((v - min) / (max - min || 1)) * (h - 4)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-[22px] w-[84px]", className)}>
      <path d={`${d} L${w},${h} L0,${h} Z`} fill={color} opacity={0.08} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.3} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={1.8} fill={color} />
    </svg>
  );
}

// Before value and an after *range*. Never a single crisp number.
export function RangeBar({ before, lo, hi, min = 0, max = 500, className }: { before: number; lo: number; hi: number; min?: number; max?: number; className?: string }) {
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  return (
    <div className={cn("relative h-6", className)}>
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-black/10" />
      <div className="hatch absolute top-1/2 h-3 -translate-y-1/2 rounded-sm bg-ok/20 ring-1 ring-inset ring-ok/50" style={{ left: `${pct(lo)}%`, width: `${Math.max(0.8, pct(hi) - pct(lo))}%` }} />
      <div className="absolute top-1/2 h-px -translate-y-1/2 bg-[linear-gradient(90deg,transparent,rgb(18_17_16/0.3))]" style={{ left: `${pct(hi)}%`, width: `${Math.max(0, pct(before) - pct(hi))}%` }} />
      <div className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-fg ring-1 ring-black/30" style={{ left: `${pct(before)}%` }} />
    </div>
  );
}
