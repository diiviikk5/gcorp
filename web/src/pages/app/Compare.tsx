import { useMemo, useState } from "react";
import { Link } from "react-router";
import { PageHeader } from "@/components/app/AppLayout";
import { getBundle, useRuns } from "@/store/runs";
import { recommend } from "@/lib/recommend";
import { fmt } from "@/lib/aqi";
import { cn } from "@/lib/cn";

// Planners choose between options. Rank by exposure averted (population-weighted),
// shown as ranges on one shared scale.
export default function Compare() {
  const runs = useRuns((s) => s.runs);
  const [picked, setPicked] = useState<string[]>(() => runs.filter((r) => r.kind === "assessment").slice(0, 3).map((r) => r.id));
  const rows = useMemo(
    () =>
      runs
        .filter((r) => picked.includes(r.id))
        .map((r) => {
          const b = getBundle(r);
          return { r, b, s: b.sims[2].summary, rec: recommend(b) };
        })
        .sort((a, b) => b.s.exposureLo + b.s.exposureHi - (a.s.exposureLo + a.s.exposureHi)),
    [runs, picked],
  );
  const maxExp = Math.max(1, ...rows.map((x) => x.s.exposureHi));
  const maxPct = Math.max(1, ...rows.map((x) => x.s.pctHi));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const Bar = ({ lo, hi, max }: { lo: number; hi: number; max: number }) => (
    <div className="relative h-1.5 rounded-full bg-white/[0.06]">
      <div className="absolute inset-y-0 rounded-full bg-fg" style={{ left: `${(lo / max) * 100}%`, width: `${Math.max(1, ((hi - lo) / max) * 100)}%` }} />
    </div>
  );

  return (
    <div>
      <PageHeader title="Compare" />
      <div className="mx-auto max-w-[1080px] px-6 py-8">
        <div className="flex flex-wrap gap-1.5">
          {runs.map((r) => (
            <button
              key={r.id}
              onClick={() => toggle(r.id)}
              className={cn("rounded-full px-3 py-1 text-[12px] ring-1 ring-inset transition-colors", picked.includes(r.id) ? "bg-fg text-black ring-fg" : "text-mute ring-line hover:text-fg")}
            >
              {r.scenario.title.split(" · ").slice(0, 2).join(" · ")}
            </button>
          ))}
        </div>

        <table className="mt-8 w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11.5px] text-faint">
              <th className="w-8 py-2.5 font-normal">#</th>
              <th className="py-2.5 font-normal">Policy</th>
              <th className="w-[26%] py-2.5 font-normal">Exposure averted</th>
              <th className="w-[22%] py-2.5 font-normal">AQI reduction</th>
              <th className="hidden py-2.5 text-right font-normal md:table-cell">Verdict</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(({ r, s, rec }, i) => (
              <tr key={r.id}>
                <td className="py-4 font-mono text-[12px] text-faint">{i + 1}</td>
                <td className="py-4 pr-4">
                  <Link to={`/app/runs/${r.id}`} className="hover:underline">{r.scenario.title}</Link>
                </td>
                <td className="py-4 pr-6">
                  <Bar lo={s.exposureLo} hi={s.exposureHi} max={maxExp} />
                  <div className="mt-1.5 font-mono text-[11px] text-mute tabular">{fmt(s.exposureLo)}–{fmt(s.exposureHi)} idx</div>
                </td>
                <td className="py-4 pr-6">
                  <Bar lo={s.pctLo} hi={s.pctHi} max={maxPct} />
                  <div className="mt-1.5 font-mono text-[11px] text-mute tabular">{fmt(s.pctLo, 1)}–{fmt(s.pctHi, 1)}%</div>
                </td>
                <td className={cn("hidden py-4 text-right md:table-cell", rec.verdict === "reject" ? "text-bad" : "text-mute")}>{rec.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div className="py-16 text-center text-[13px] text-mute">Pick two or more assessments to compare.</div>}
        <p className="mt-6 text-[12px] text-faint">Exposure averted is a population-weighted index (residents × AQI points × days). Ranges, not point estimates.</p>
      </div>
    </div>
  );
}
