import { cn } from "@/lib/cn";

// 24 hourly bars. Ink for the level, a hatched cap for the band, accent for a highlighted window.
export function HourlyBars({ values, lo, hi, highlight, min = 0, height = 120, label, className }: { values: number[]; lo?: number[]; hi?: number[]; highlight?: [number, number]; min?: number; height?: number; label?: (h: number) => string; className?: string }) {
  const top = Math.max(...(hi ?? values)) * 1.04;
  const y = (v: number) => height - ((v - min) / (top - min || 1)) * height;
  return (
    <div className={className}>
      <svg viewBox={`0 0 ${24 * 14} ${height + 16}`} className="w-full" role="img" aria-label="Hourly values">
        {values.map((v, h) => {
          const inWin = highlight && h >= highlight[0] && h < highlight[1];
          return (
            <g key={h}>
              {lo && hi && <rect x={h * 14 + 2} y={y(hi[h])} width={10} height={Math.max(1, y(lo[h]) - y(hi[h]))} className="fill-black/[0.08]" />}
              <rect x={h * 14 + 2} y={y(v)} width={10} height={height - y(v)} className={cn(inWin ? "fill-[var(--color-accent)]" : "fill-fg/80")} />
              {h % 3 === 0 && <text x={h * 14 + 7} y={height + 12} textAnchor="middle" className="fill-faint font-mono text-[8px]">{label ? label(h) : String(h).padStart(2, "0")}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
