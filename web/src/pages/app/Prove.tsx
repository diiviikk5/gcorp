import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app/AppLayout";
import { RefChip } from "@/components/ui/RichText";
import { EngineGate } from "@/components/app/EngineGate";
import { api, type TrackRecord } from "@/lib/api";
import { fmt } from "@/lib/aqi";
import { cn } from "@/lib/cn";

// The track record: past Delhi policies replayed through the same pipeline,
// scored against what was observed. Calibration is leave-one-out.
export default function Prove() {
  const [tr, setTr] = useState<TrackRecord | null>(null);
  const [calibrated, setCalibrated] = useState(true);
  useEffect(() => { api.trackRecord().then(setTr).catch(() => setTr(null)); }, []);
  const max = 10;
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;

  return (
    <EngineGate>
      <PageHeader title="Track record" />
      <div className="mx-auto max-w-[1080px] px-6 py-8">
        <h1 className="text-[26px] font-semibold tracking-[-0.03em]">Checked against what actually happened.</h1>
        <p className="mt-1.5 max-w-2xl text-[14px] text-mute">
          Each past policy runs through the same compiler and simulator. A hit means the predicted range overlaps the observed one. Calibration learns each policy type's bias from the <em>other</em> replays only, so no case ever sees its own answer.
        </p>

        {tr && (
          <>
            <div className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
              <div className="bg-bg p-5"><div className="text-[12px] text-mute">Raw model</div><div className="mt-2 text-[30px] font-semibold tabular">{tr.hits}/{tr.total}</div></div>
              <div className="bg-bg p-5"><div className="text-[12px] text-mute">After leave-one-out calibration</div><div className="mt-2 text-[30px] font-semibold tabular">{tr.hitsCalibrated}/{tr.total}</div></div>
              <div className="bg-bg p-5"><div className="text-[12px] text-mute">What it learned</div><div className="mt-2 text-[13.5px]">{tr.cases.filter((c) => c.factor !== 1).length ? `Car rationing was under-predicted ×${tr.cases.find((c) => c.factor !== 1)!.factor.toFixed(1)}; other policy types held.` : "No systematic bias found."}</div></div>
            </div>

            <div className="mt-8 flex items-center justify-between">
              <h2 className="text-[14px] font-medium">Replays</h2>
              <label className="flex items-center gap-2 text-[12.5px] text-mute"><input type="checkbox" checked={calibrated} onChange={(e) => setCalibrated(e.target.checked)} className="accent-black" /> show calibrated</label>
            </div>
            <div className="mt-3 divide-y divide-line border-y border-line">
              {tr.cases.map((c) => {
                const p = calibrated ? c.calibrated : c.predicted;
                const hit = calibrated ? c.hitCalibrated : c.hit;
                return (
                  <div key={c.id} className="grid grid-cols-[1fr_minmax(0,1.2fr)_60px] items-center gap-6 py-4 text-[13px]">
                    <div>
                      <div>{c.name}</div>
                      <div className="mt-0.5 text-[11.5px] text-faint">observed <RefChip refId={c.observedRef} /> {c.factor !== 1 && calibrated && <>· factor ×{c.factor} from {c.calibratedFrom.length} other replay{c.calibratedFrom.length > 1 ? "s" : ""}</>}</div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="relative h-2">
                        <div className="absolute inset-x-0 top-1/2 h-px bg-line-2" />
                        <div className="absolute inset-y-0 rounded-sm bg-fg" style={{ left: pct(p[0]), width: `calc(${pct(p[1])} - ${pct(p[0])})` }} />
                      </div>
                      <div className="relative h-2">
                        <div className="absolute inset-x-0 top-1/2 h-px bg-line-2" />
                        <div className="hatch absolute inset-y-0 rounded-sm ring-1 ring-inset ring-fg/60" style={{ left: pct(c.observed[0]), width: `calc(${pct(c.observed[1])} - ${pct(c.observed[0])})` }} />
                      </div>
                      <div className="flex justify-between font-mono text-[10.5px] text-mute"><span>estimate {fmt(p[0], 1)}–{fmt(p[1], 1)}%</span><span>observed {c.observed[0]}–{c.observed[1]}%</span></div>
                    </div>
                    <span className={cn("text-right font-mono text-[12px]", hit ? "text-fg" : "text-bad")}>{hit ? "HIT" : "MISS"}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10px] text-faint"><span>solid: estimate · hatched: observed</span><span>scale 0–{max}% PM2.5 reduction</span></div>
            <p className="mt-6 text-[12px] text-faint">{tr.note}</p>
          </>
        )}
      </div>
    </EngineGate>
  );
}
