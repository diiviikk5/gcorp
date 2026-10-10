import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/app/AppLayout";
import { HourlyBars } from "@/components/ui/Hourly";
import { RefChip } from "@/components/ui/RichText";
import { EngineGate } from "@/components/app/EngineGate";
import { api, type Breathe as B } from "@/lib/api";
import { ZONES } from "@/sim/city";
import { useRunList } from "@/store/runs";
import { aqiBand, fmt } from "@/lib/aqi";

const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

// The same engine, made personal: when should a school in this zone hold
// outdoor time, today and under a proposed policy?
export default function Breathe() {
  const runs = useRunList();
  const [zone, setZone] = useState("anandvihar");
  const [runId, setRunId] = useState<string>("");
  const [base, setBase] = useState<B | null>(null);
  const [withPolicy, setWithPolicy] = useState<B | null>(null);
  const zoneRuns = useMemo(() => runs.filter((r) => r.scenario.zoneId === zone), [runs, zone]);

  useEffect(() => { api.breathe(zone).then(setBase); setRunId(""); setWithPolicy(null); }, [zone]);
  useEffect(() => { if (runId) api.breathe(zone, runId).then(setWithPolicy); else setWithPolicy(null); }, [zone, runId]);

  const show = withPolicy ?? base;
  const best = show?.bestWindow;
  const bestMid = show && best ? (show.hours[best[0]].mid + show.hours[best[0] + 1].mid) / 2 : 0;

  return (
    <EngineGate>
      <PageHeader title="Breathe" />
      <div className="mx-auto max-w-[1080px] px-6 py-8">
        <h1 className="text-[26px] font-semibold tracking-[-0.03em]">When should children play outside?</h1>
        <p className="mt-1.5 max-w-xl text-[14px] text-mute">An hourly estimate for a typical winter day in each zone, as a band. Pick a policy to see the hours it changes.</p>

        <div className="mt-6 flex flex-wrap gap-4">
          <select value={zone} onChange={(e) => setZone(e.target.value)} className="h-9 rounded-md bg-transparent px-2 text-[13.5px] ring-1 ring-inset ring-line-2">
            {ZONES.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
          <select value={runId} onChange={(e) => setRunId(e.target.value)} className="h-9 min-w-[280px] rounded-md bg-transparent px-2 text-[13.5px] ring-1 ring-inset ring-line-2">
            <option value="">Today, no new policy</option>
            {zoneRuns.map((r) => <option key={r.id} value={r.id}>{r.scenario.title}</option>)}
          </select>
        </div>

        {show && best && (
          <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_300px]">
            <div className="rounded-xl border border-line p-5">
              <HourlyBars values={show.hours.map((h) => h.mid)} lo={show.hours.map((h) => h.lo)} hi={show.hours.map((h) => h.hi)} highlight={best} min={Math.min(...show.hours.map((h) => h.lo)) * 0.85} height={180} />
              <div className="mt-3 flex justify-between text-[11.5px] text-faint"><span>hour of day</span><span>shape from <RefChip refId="L-023" /> and <RefChip refId="L-024" /></span></div>
            </div>
            <div className="space-y-4">
              <div className="rounded-xl border border-fg p-5">
                <div className="font-mono text-[11px] tracking-wider text-mute">BEST SCHOOL-HOURS WINDOW</div>
                <div className="mt-2 text-[34px] font-semibold tracking-[-0.03em]">{hh(best[0])}–{hh(best[1])}</div>
                <div className="mt-1 text-[13px] text-mute">about AQI {fmt(bestMid)} ({aqiBand(bestMid).label.toLowerCase()})</div>
              </div>
              <div className="rounded-xl border border-line p-5 text-[13px]">
                <div className="text-mute">Worst hour</div>
                <div className="mt-1 text-[20px] font-semibold">{hh(show.worstHour)}</div>
                <div className="mt-1 text-[12px] text-mute">Evening traffic under a collapsing mixing layer.</div>
              </div>
              {withPolicy && (
                <div className="rounded-xl border border-line p-5 text-[13px]">
                  <div className="text-mute">The policy helps most at</div>
                  <div className="mt-1 text-[20px] font-semibold">{hh(withPolicy.hours.reduce((a, b) => (b.cut > a.cut ? b : a)).hour)}</div>
                  <div className="mt-1 text-[12px] text-mute">up to −{fmt(Math.max(...withPolicy.hours.map((h) => h.cut)))} AQI in that hour</div>
                </div>
              )}
            </div>
          </div>
        )}
        <p className="mt-6 text-[12px] text-faint">An estimate under stated assumptions, not a forecast. Check live readings before acting on a specific day.</p>
      </div>
    </EngineGate>
  );
}
