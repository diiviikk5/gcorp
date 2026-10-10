import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/app/AppLayout";
import { Button } from "@/components/ui/Button";
import { RefChip } from "@/components/ui/RichText";
import { EngineGate } from "@/components/app/EngineGate";
import { api, type OptimiseResult } from "@/lib/api";
import { ZONES } from "@/sim/city";
import { useRuns } from "@/store/runs";
import { fmt } from "@/lib/aqi";
import { cn } from "@/lib/cn";

// Reverse the question: the planner states a goal and a budget, the engine
// searches policy combinations and ranks them by how surely they hit it.
export default function Plan() {
  const [zone, setZone] = useState("anandvihar");
  const [target, setTarget] = useState(15);
  const [budget, setBudget] = useState(2);
  const [months, setMonths] = useState(3);
  const [res, setRes] = useState<OptimiseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const createRemote = useRuns((s) => s.createRemote);
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => {
      setBusy(true);
      api.optimise(zone, target, budget, months).then(setRes).catch(() => setRes(null)).finally(() => setBusy(false));
    }, 250);
    return () => clearTimeout(t);
  }, [zone, target, budget, months]);

  const maxHi = Math.max(target * 1.5, ...(res?.portfolios.map((p) => p.deltaHi) ?? [1]));

  return (
    <EngineGate>
      <PageHeader title="Plan" />
      <div className="mx-auto max-w-[1080px] px-6 py-8">
        <h1 className="text-[26px] font-semibold tracking-[-0.03em]">Set the goal. The council finds the policies.</h1>
        <p className="mt-1.5 max-w-xl text-[14px] text-mute">Every combination is simulated and ranked by the chance it meets the goal within the budget. Ranges, never point promises.</p>

        <div className="mt-8 grid gap-6 rounded-xl border border-line p-5 sm:grid-cols-4">
          <label className="text-[12px] text-mute">Zone
            <select value={zone} onChange={(e) => setZone(e.target.value)} className="mt-1.5 block h-9 w-full rounded-md bg-transparent px-2 text-[13.5px] text-fg ring-1 ring-inset ring-line-2">
              {ZONES.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </label>
          {([["Cut AQI by", target, setTarget, 2, 40, 1, " pts"], ["Budget", budget, setBudget, 0.25, 10, 0.25, " ₹ cr"], ["Over", months, setMonths, 1, 12, 1, " months"]] as const).map(([k, v, set, lo, hi, step, unit]) => (
            <label key={k} className="text-[12px] text-mute">
              <span className="flex justify-between">{k}<span className="font-mono text-fg">{v}{unit}</span></span>
              <input type="range" min={lo} max={hi} step={step} value={v} onChange={(e) => (set as (n: number) => void)(Number(e.target.value))} className="mt-3 w-full accent-black" />
            </label>
          ))}
        </div>

        {res?.note && <div className="mt-5 border-l-2 border-[var(--color-accent)] pl-3 text-[13.5px]">{res.note}</div>}

        <div className={cn("mt-8 transition-opacity", busy && "opacity-50")}>
          <div className="flex items-baseline justify-between"><h2 className="text-[14px] font-medium">Ranked portfolios</h2><span className="text-[12px] text-faint">costs from <RefChip refId="L-025" /> <RefChip refId="L-026" /> <RefChip refId="L-031" /></span></div>
          <div className="mt-3 divide-y divide-line border-y border-line">
            {res?.portfolios.map((p, i) => (
              <div key={p.levers.join()} className="grid grid-cols-[28px_1fr_160px_70px_80px] items-center gap-4 py-3.5 text-[13px]">
                <span className="font-mono text-faint">{i + 1}</span>
                <span>{p.labels.join(" + ")}</span>
                <div>
                  <div className="relative h-1.5 rounded-full bg-black/[0.06]">
                    <div className="absolute inset-y-0 rounded-full bg-fg" style={{ left: `${(p.deltaLo / maxHi) * 100}%`, width: `${Math.max(1, ((p.deltaHi - p.deltaLo) / maxHi) * 100)}%` }} />
                    <div className="absolute -top-1 h-3.5 w-px bg-[var(--color-accent)]" style={{ left: `${(target / maxHi) * 100}%` }} />
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-mute">−{fmt(p.deltaLo)} to −{fmt(p.deltaHi)} AQI</div>
                </div>
                <span className="text-right font-mono text-[12px]">₹{p.cost.toFixed(2)}</span>
                <span className={cn("text-right font-mono text-[13px]", p.pTarget >= 0.8 ? "text-fg" : "text-mute")}>{Math.round(p.pTarget * 100)}%</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-end gap-6 text-[11px] text-faint"><span>cost over the period</span><span>chance of meeting the goal</span></div>
        </div>

        <div className="mt-10">
          <h2 className="text-[14px] font-medium">Levers on their own</h2>
          <div className="mt-3 divide-y divide-line border-y border-line">
            {res?.levers.map((l) => (
              <div key={l.id} className="flex items-center gap-4 py-3 text-[13px]">
                <span className="min-w-0 flex-1">{l.label}<span className="ml-2 text-[12px] text-faint">{l.policy}</span></span>
                <span className="font-mono text-[12px] text-mute">−{fmt(l.deltaLo)} to −{fmt(l.deltaHi)}</span>
                <span className="w-16 text-right font-mono text-[12px]">₹{l.cost.toFixed(2)}</span>
                <Button size="sm" variant="ghost" onClick={() => createRemote(l.policy, zone).then((id) => navigate(`/app/runs/${id}?live=1`))}>Convene <ArrowRight className="size-3" /></Button>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-faint">Effects are combined additively at each end of the range, an approximation the brief states openly.</p>
        </div>
      </div>
    </EngineGate>
  );
}
