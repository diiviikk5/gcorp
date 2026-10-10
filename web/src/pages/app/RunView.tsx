import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { ChevronRight, FastForward, FileText, Pause, Play, RotateCcw, Share2, TriangleAlert } from "lucide-react";
import { IsoCity, type CityAgent } from "@/components/city/IsoCity";
import { ScenarioCard, StageRail } from "@/components/app/run/ScenarioPanel";
import { Transcript } from "@/components/app/run/Transcript";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Segmented } from "@/components/ui/Segmented";
import { AqiScale, RangeBar } from "@/components/ui/Aqi";
import { RefChip } from "@/components/ui/RichText";
import { useRun } from "@/store/runs";
import { derive, eventIndex, usePlayback } from "@/store/playback";
import { AGENTS, STAGES } from "@/sim/council";
import type { AgentId } from "@/lib/types";
import { cn } from "@/lib/cn";
import { fmt } from "@/lib/aqi";

const CITY_AGENTS: CityAgent[] = (["compiler", "simulator", "engineer", "epidemiologist", "economist", "skeptic", "verifier", "writer"] as AgentId[]).map((id) => ({ id, color: AGENTS[id].color, label: `${AGENTS[id].name}` }));

export default function RunView() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const bundle = useRun(id);
  const { elapsed, playing, speed, load, tick, setPlaying, setSpeed, seek, runId } = usePlayback();
  const [layer, setLayer] = useState<"haze" | "tiles" | "delta">("haze");
  const [view, setView] = useState<"auto" | "before" | "after">("auto");
  const [panel, setPanel] = useState<"council" | "policy">("council");
  const duration = bundle?.script.duration ?? 0;

  useEffect(() => {
    if (!bundle) return;
    const live = sp.get("live") === "1";
    if (runId !== bundle.record.id || live) load(bundle.record.id, live, duration);
    if (live) setSp({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle?.record.id]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      tick(now - last, duration);
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tick, duration]);

  const idx = bundle ? eventIndex(bundle.script.events, runId === bundle.record.id ? elapsed : duration) : 0;
  const d = useMemo(() => (bundle ? derive(bundle, idx) : null), [bundle, idx]);

  if (!bundle || !d) {
    return (
      <div className="grid h-full place-items-center text-center">
        <div>
          <div className="text-[15px] font-medium">Run not found</div>
          <Link to="/app/assessments" className="mt-2 inline-block text-[13px] text-brand hover:underline">Back to assessments</Link>
        </div>
      </div>
    );
  }

  const rec = bundle.record;
  const scenario = rec.scenario;
  const round = Math.max(1, d.simRound);
  const sim = bundle.sims[round];
  const ctx = { scenario, sim, overrides: d.params };
  const showAfter = view === "after" || (view === "auto" && d.simRound > 0);
  const field = { before: sim.before, afterLo: sim.afterLo, afterHi: sim.afterHi, unc: sim.uncertainty };
  const running = !d.complete;
  const currentStage = STAGES.find((s) => d.stages[s.id] === "running");
  const blocked = scenario.warnings.some((w) => w.level === "block");

  const verdictFocus = (() => {
    if (!d.lastVerdict) return null;
    const m = d.events.find((e) => e.type === "message" && e.claimId === d.lastVerdict!.claimId);
    const f = (m && m.type === "message" && m.focus) || d.focus;
    return f ? { key: `${d.lastVerdict.claimId}-${d.lastVerdict.t}`, status: d.lastVerdict.status, at: f } : null;
  })();
  const pctDone = duration ? Math.min(1, (runId === rec.id ? elapsed : duration) / duration) : 1;

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="z-20 flex h-12 shrink-0 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
          <Link to="/app/assessments" className="text-mute hover:text-fg">Assessments</Link>
          <ChevronRight className="size-3.5 text-faint" />
          <span className="truncate font-medium">{scenario.title}</span>
          {rec.kind === "replay" && <Badge tone="violet" className="ml-1">Replay</Badge>}
        </div>
        <div className="ml-2 hidden items-center gap-2 lg:flex">
          {running ? (
            <Badge tone="brand" dot className="[&>span:first-child]:animate-pulse">{currentStage ? `${currentStage.label}…` : "Starting…"}</Badge>
          ) : (
            <Badge tone={blocked ? "bad" : "ok"} dot>{blocked ? "Complete · not recommended" : "Complete"}</Badge>
          )}
          <RefChip refId="fp" ctx={ctx} runId={rec.id} className="!text-[11px]" />
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <div className="hidden items-center gap-1 rounded-lg p-0.5 ring-1 ring-inset ring-line sm:flex">
            <button onClick={() => { seek(0); setPlaying(true); }} className="grid size-7 place-items-center rounded-md text-mute hover:bg-black/5 hover:text-fg" title="Replay from start"><RotateCcw className="size-3.5" /></button>
            <button onClick={() => { if (pctDone >= 1) seek(0); setPlaying(!playing); }} className="grid size-7 place-items-center rounded-md text-fg hover:bg-black/5" title={playing ? "Pause" : "Play"}>{playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}</button>
            <button onClick={() => { seek(duration); setPlaying(false); }} className="grid size-7 place-items-center rounded-md text-mute hover:bg-black/5 hover:text-fg" title="Skip to end"><FastForward className="size-3.5" /></button>
            <Segmented value={String(speed)} onChange={(v) => setSpeed(Number(v))} options={[{ value: "1", label: "1×" }, { value: "2", label: "2×" }, { value: "4", label: "4×" }]} className="!ring-0 !bg-transparent" />
          </div>
          <Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(location.origin + `/app/runs/${rec.id}/brief`)} title="Copy brief link"><Share2 className="size-3.5" /></Button>
          <Button size="sm" variant={d.complete ? "primary" : "secondary"} to={`/app/runs/${rec.id}/brief`} className={cn(!d.complete && "pointer-events-none opacity-50")}>
            <FileText className="size-3.5" /> Open brief
          </Button>
        </div>
      </div>
      <div className="h-px w-full bg-line">
        <motion.div className="h-px bg-brand" animate={{ width: `${pctDone * 100}%` }} transition={{ duration: 0.2 }} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_380px] 2xl:grid-cols-[1fr_420px]">
        {/* Center: the city */}
        <section className="relative min-h-[420px] overflow-hidden bg-[radial-gradient(ellipse_at_50%_40%,#f8f7f3_0%,#ebe8e1_75%)]">
          <div className="grid-bg pointer-events-none absolute inset-0 opacity-60" />
          <IsoCity
            mode="app"
            className="absolute inset-0"
            field={field}
            showAfter={showAfter}
            layer={layer}
            zoneId={scenario.zoneId}
            focus={d.focus}
            agents={CITY_AGENTS}
            activeAgent={d.activeAgent}
            verdict={verdictFocus}
            policyClass={scenario.vehicleClass}
          />

          {/* Result card */}
          <div className="pointer-events-none absolute left-4 top-4 w-[280px]">
            <div className="glass pointer-events-auto rounded-xl p-3.5">
              <div className="flex items-center justify-between">
                <span className="eyebrow">{scenario.zoneId === "all" ? "City mean" : `${scenario.params.zone.value} · zone mean`}</span>
                <span className="font-mono text-[10px] text-faint">round {d.simRound || "–"}</span>
              </div>
              {d.simRound === 0 ? (
                <div className="mt-3 space-y-2">
                  <div className="shimmer h-6 w-40 rounded" />
                  <div className="shimmer h-3 w-full rounded" />
                </div>
              ) : (
                <>
                  <div className="mt-1.5 flex items-baseline gap-2 text-[22px] font-semibold tracking-tight tabular">
                    <RefChip refId="sim:zoneBefore" ctx={ctx} runId={rec.id} className="!text-[15px]" />
                    <span className="text-faint">→</span>
                    <RefChip refId="sim:zoneAfterRange" ctx={ctx} runId={rec.id} className="!text-[15px]" />
                  </div>
                  <RangeBar className="mt-2" before={sim.summary.zoneBefore} lo={sim.summary.zoneAfterLo} hi={sim.summary.zoneAfterHi} min={Math.max(0, sim.summary.zoneBefore - 120)} max={sim.summary.zoneBefore + 20} />
                  <div className="mt-2 text-[11.5px] leading-relaxed text-mute">
                    Under these assumptions, the estimated reduction is <RefChip refId="sim:deltaRange" ctx={ctx} runId={rec.id} /> AQI points (<RefChip refId="sim:pctRange" ctx={ctx} runId={rec.id} />).
                  </div>
                  {sim.summary.coverage !== "good" && (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-warn"><TriangleAlert className="size-3" /> Thin sensor coverage widens this band</div>
                  )}
                  {rec.observed && (
                    <div className="mt-2.5 flex items-center justify-between rounded-lg bg-a-skeptic/[0.08] px-2.5 py-1.5 text-[11px] ring-1 ring-inset ring-a-skeptic/25">
                      <span className="text-a-skeptic">{rec.observed.label}</span>
                      <RefChip refId={rec.observed.ledgerRef} runId={rec.id} />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Layer controls */}
          <div className="absolute right-4 top-4 flex flex-col items-end gap-2">
            <Segmented value={layer} onChange={setLayer} className="glass" options={[{ value: "haze", label: "Haze" }, { value: "tiles", label: "AQI grid" }, { value: "delta", label: "Change" }]} />
            <Segmented value={view} onChange={setView} className="glass" options={[{ value: "auto", label: "Live" }, { value: "before", label: "Before" }, { value: "after", label: "After" }]} />
          </div>

          {/* Bottom bar: legend + timeline */}
          <div className="pointer-events-none absolute inset-x-4 bottom-4 flex flex-wrap items-end justify-between gap-3">
            <div className="glass pointer-events-auto flex items-center gap-4 rounded-xl px-3.5 py-2.5 text-[11px] text-mute">
              {layer === "delta" ? (
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[#4fe3c1]" /> Cleaner</span>
                  <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[#ff7a59]" /> Displaced load</span>
                </div>
              ) : (
                <AqiScale />
              )}
              <span className="h-6 w-px bg-line-2" />
              <span className="flex items-center gap-1.5 whitespace-nowrap"><span className="hatch size-3 rounded-sm ring-1 ring-black/20" /> Thin data</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rotate-45 bg-aqi-poor" /> Station</span>
            </div>

            <div className="glass pointer-events-auto hidden min-w-[260px] flex-1 basis-[260px] rounded-xl px-3 py-2.5 lg:block" style={{ maxWidth: 440 }}>
              <div className="relative h-5 cursor-pointer" onClick={(e) => {
                const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                seek(((e.clientX - r.left) / r.width) * duration);
              }}>
                <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-black/10" />
                <div className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-brand" style={{ width: `${pctDone * 100}%` }} />
                {bundle.script.events.map((e, i) => {
                  if (e.type !== "verdict" && e.type !== "sim") return null;
                  const c = e.type === "sim" ? "bg-a-simulator" : e.status === "accepted" ? "bg-ok" : e.status === "rejected" ? "bg-bad" : "bg-warn";
                  return <span key={i} className={cn("absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full", c, e.t > elapsed && runId === rec.id && "opacity-30")} style={{ left: `${(e.t / duration) * 100}%` }} />;
                })}
              </div>
              <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
                {STAGES.map((s) => <span key={s.id} className={d.stages[s.id] === "idle" ? "" : d.stages[s.id] === "running" ? "text-brand" : "text-mute"}>{s.label}</span>)}
              </div>
            </div>
          </div>

          <AnimatePresence>
            {d.complete && pctDone >= 1 && !blocked && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute left-1/2 top-4 -translate-x-1/2">
                <Link to={`/app/runs/${rec.id}/brief`} className="glass flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-medium text-fg hover:bg-black/10">
                  <span className="size-1.5 rounded-full bg-ok" /> Brief ready: {fmt(sim.summary.deltaLo)}–{fmt(sim.summary.deltaHi)} AQI points <ChevronRight className="size-3.5" />
                </Link>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Right */}
        <aside className="hidden min-h-0 flex-col border-l border-line lg:flex">
          <div className="flex h-11 shrink-0 items-center border-b border-line px-3">
            <Segmented value={panel} onChange={setPanel} options={[{ value: "council", label: "Council" }, { value: "policy", label: "Policy" }]} />
          </div>
          <div className="min-h-0 flex-1">
            {panel === "council" ? (
              <Transcript events={d.events} claims={d.claims} ctx={ctx} runId={rec.id} activeAgent={d.activeAgent} complete={d.complete} />
            ) : (
              <div className="h-full space-y-7 overflow-y-auto p-4">
                <ScenarioCard scenario={scenario} overrides={d.params} runId={rec.id} />
                <StageRail stages={d.stages} />
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
