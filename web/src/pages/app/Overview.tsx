import { Link } from "react-router";
import { ArrowRight, Plus } from "lucide-react";
import { PageHeader } from "@/components/app/AppLayout";
import { Button } from "@/components/ui/Button";
import { AqiPill } from "@/components/ui/Aqi";
import { ZONES, getCity, zoneBaseline, zoneCoverage } from "@/sim/city";
import { bundleFor, finalSim, useRunList } from "@/store/runs";
import { recommend } from "@/lib/recommend";
import { aqiBand, fmt, relTime } from "@/lib/aqi";
import { cn } from "@/lib/cn";

export default function Overview() {
  const runs = useRunList();
  const city = getCity().city;
  const mean = zoneBaseline("all");
  const zones = ZONES.map((z) => ({ ...z, aqi: zoneBaseline(z.id), cov: zoneCoverage(z.id) })).sort((a, b) => b.aqi - a.aqi);
  const covered = zones.filter((z) => z.cov !== "none").length;

  return (
    <div>
      <PageHeader title="Overview" actions={<Button variant="primary" size="sm" to="/app/new"><Plus className="size-3.5" /> New assessment</Button>} />
      <div className="mx-auto max-w-[1080px] px-6 py-10">
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
          {[
            { k: "Delhi, city mean", v: fmt(mean), sub: aqiBand(mean).label },
            { k: "Zones with usable sensors", v: `${covered}/${zones.length}`, sub: `${city.stations.length} stations` },
            { k: "Assessments", v: String(runs.length), sub: `${runs.filter((r) => r.kind === "replay").length} replay` },
          ].map((s) => (
            <div key={s.k} className="bg-bg px-5 py-5">
              <div className="text-[12px] text-mute">{s.k}</div>
              <div className="mt-2 text-[30px] font-semibold tracking-[-0.03em] tabular">{s.v}</div>
              <div className="text-[12px] text-faint">{s.sub}</div>
            </div>
          ))}
        </div>

        <section className="mt-12">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[14px] font-medium">Recent assessments</h2>
            <Link to="/app/assessments" className="text-[12.5px] text-mute hover:text-fg">View all</Link>
          </div>
          <div className="mt-3 divide-y divide-line border-y border-line">
            {runs.slice(0, 5).map((r) => {
              const b = bundleFor(r);
              const s = finalSim(b).summary;
              const rec = recommend(b);
              return (
                <Link key={r.id} to={`/app/runs/${r.id}`} className="group flex items-center gap-4 py-3.5 text-[13px] transition-colors hover:bg-black/[0.02]">
                  <span className="min-w-0 flex-1 truncate">{r.scenario.title}</span>
                  <span className={cn("hidden w-[150px] text-[12px] sm:block", rec.verdict === "reject" ? "text-bad" : "text-mute")}>{rec.label}</span>
                  <span className="w-[110px] text-right font-mono text-[12px] text-mute tabular">−{fmt(s.deltaLo)} to −{fmt(s.deltaHi)}</span>
                  <span className="w-[70px] text-right text-[12px] text-faint">{relTime(r.createdAt)}</span>
                  <ArrowRight className="size-3.5 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              );
            })}
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-[14px] font-medium">Zones</h2>
          <div className="mt-3 overflow-hidden border-y border-line">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11.5px] text-faint">
                  <th className="py-2.5 font-normal">Zone</th>
                  <th className="py-2.5 font-normal">Baseline</th>
                  <th className="hidden py-2.5 font-normal sm:table-cell">Sensors</th>
                  <th className="hidden py-2.5 text-right font-normal md:table-cell">Schools</th>
                  <th className="py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {zones.map((z) => (
                  <tr key={z.id} className="group">
                    <td className="py-3">
                      <div>{z.name}</div>
                      <div className="text-[11.5px] text-faint">{z.district}</div>
                    </td>
                    <td className="py-3"><AqiPill value={z.aqi} /></td>
                    <td className={cn("hidden py-3 text-[12.5px] sm:table-cell", z.cov === "none" ? "text-bad" : "text-mute")}>{z.cov === "good" ? "Good" : z.cov === "thin" ? "Thin" : "None"}</td>
                    <td className="hidden py-3 text-right text-mute tabular md:table-cell">{z.schools}</td>
                    <td className="py-3 text-right">
                      <Link to={`/app/new?zone=${z.id}`} className="text-[12.5px] text-faint transition-colors group-hover:text-fg">Assess →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
