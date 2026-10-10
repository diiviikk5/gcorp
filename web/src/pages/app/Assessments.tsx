import { useState } from "react";
import { Link } from "react-router";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/app/AppLayout";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { bundleFor, finalSim, useRunList } from "@/store/runs";
import { recommend } from "@/lib/recommend";
import { fmt, relTime } from "@/lib/aqi";
import { cn } from "@/lib/cn";

export default function Assessments() {
  const runs = useRunList();
  const [filter, setFilter] = useState<"all" | "assessment" | "replay">("all");
  const list = runs.filter((r) => filter === "all" || r.kind === filter);

  return (
    <div>
      <PageHeader
        title="Assessments"
        actions={
          <>
            <Segmented value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "assessment", label: "Assessments" }, { value: "replay", label: "Replays" }]} />
            <Button variant="primary" size="sm" to="/app/new"><Plus className="size-3.5" /> New</Button>
          </>
        }
      />
      <div className="mx-auto max-w-[1080px] px-6 py-8">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11.5px] text-faint">
              <th className="py-2.5 font-normal">Policy</th>
              <th className="hidden py-2.5 font-normal md:table-cell">Recommendation</th>
              <th className="py-2.5 text-right font-normal">AQI change</th>
              <th className="hidden py-2.5 text-right font-normal sm:table-cell">Claims</th>
              <th className="hidden py-2.5 text-right font-normal lg:table-cell">Run</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.map((r) => {
              const b = bundleFor(r);
              const s = finalSim(b).summary;
              const rec = recommend(b);
              const claims = Object.values(b.script.claims);
              const rej = claims.filter((c) => c.status === "rejected").length;
              return (
                <tr key={r.id} className="group">
                  <td className="py-3.5">
                    <Link to={`/app/runs/${r.id}`} className="block hover:underline">{r.scenario.title}</Link>
                    <div className="mt-0.5 text-[11.5px] text-faint">{r.kind === "replay" ? "Replay · " : ""}{relTime(r.createdAt)}</div>
                  </td>
                  <td className={cn("hidden py-3.5 md:table-cell", rec.verdict === "reject" ? "text-bad" : "text-mute")}>{rec.label}</td>
                  <td className="py-3.5 text-right font-mono text-[12px] tabular">−{fmt(s.deltaLo)} to −{fmt(s.deltaHi)}</td>
                  <td className="hidden py-3.5 text-right text-mute tabular sm:table-cell">
                    {claims.length}{rej > 0 && <span className="text-bad"> · {rej} rejected</span>}
                  </td>
                  <td className="hidden py-3.5 text-right font-mono text-[11.5px] text-faint lg:table-cell">{finalSim(b).fingerprint}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && <div className="py-16 text-center text-[13px] text-mute">Nothing here yet.</div>}
      </div>
    </div>
  );
}
