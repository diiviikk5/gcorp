import { useDeferredValue, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowLeft, ArrowRight, Ban, Check, Cpu, Info, MapPin, Sparkles, Wand2, Workflow } from "lucide-react";
import { PageHeader } from "@/components/app/AppLayout";
import { IsoCity } from "@/components/city/IsoCity";
import { Button } from "@/components/ui/Button";
import { Badge, Kbd } from "@/components/ui/Badge";
import { AqiPill } from "@/components/ui/Aqi";
import { OriginTag } from "@/components/ui/Origin";
import { RefChip } from "@/components/ui/RichText";
import { ZONES, getCity, zoneBaseline, zoneCoverage } from "@/sim/city";
import { compile, EXAMPLES } from "@/sim/compiler";
import { paramDisplay } from "@/lib/refs";
import type { ParamKey } from "@/lib/types";
import { useRuns } from "@/store/runs";
import { cn } from "@/lib/cn";

const STEPS = ["Area", "Policy", "Assumptions"] as const;
const TUNABLE: { key: ParamKey; min: number; max: number; step: number; unit: string }[] = [
  { key: "reductionPct", min: 0, max: 100, step: 5, unit: "%" },
  { key: "compliancePct", min: 20, max: 100, step: 5, unit: "%" },
  { key: "durationDays", min: 7, max: 365, step: 1, unit: " days" },
];

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span className={cn("grid size-5 place-items-center rounded-full text-[10.5px] font-semibold ring-1 ring-inset transition-colors", i < step ? "bg-ok/15 text-ok ring-ok/30" : i === step ? "bg-brand/15 text-brand ring-brand/40" : "text-faint ring-line-2")}>
            {i < step ? <Check className="size-3" strokeWidth={3} /> : i + 1}
          </span>
          <span className={cn("text-[12.5px]", i === step ? "text-fg" : "text-mute")}>{s}</span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-line-2" />}
        </li>
      ))}
    </ol>
  );
}

export default function NewAssessment() {
  const navigate = useNavigate();
  const createRun = useRuns((s) => s.createRun);
  const [step, setStep] = useState(0);
  const [params] = useSearchParams();
  const [zone, setZone] = useState<string>(params.get("zone") ?? "anandvihar");
  const [text, setText] = useState("");
  const [overrides, setOverrides] = useState<Partial<Record<ParamKey, number>>>({});
  const [ack, setAck] = useState(false);
  const deferred = useDeferredValue(text);
  const { base, unc } = getCity();
  const field = useMemo(() => ({ before: base, afterLo: base, afterHi: base, unc }), [base, unc]);

  const scenario = useMemo(() => (deferred.trim().length > 6 ? compile({ text: deferred, zoneId: zone === "all" ? undefined : zone, overrides }) : null), [deferred, zone, overrides]);
  const blocking = scenario?.warnings.filter((w) => w.level === "block" && !w.ledgerRef) ?? [];
  const unknowns = scenario ? Object.values(scenario.params).filter((p) => p.origin === "unknown") : [];

  const zoneRows = useMemo(
    () => ZONES.map((z) => ({ ...z, aqi: zoneBaseline(z.id), coverage: zoneCoverage(z.id) })).sort((a, b) => b.aqi - a.aqi),
    [],
  );

  const launch = () => {
    if (!scenario) return;
    const id = createRun(scenario);
    navigate(`/app/runs/${id}?live=1`);
  };

  return (
    <div className="min-h-full">
      <PageHeader title="New assessment" actions={<Stepper step={step} />} />
      <div className="mx-auto grid max-w-[1280px] gap-8 px-6 py-8 lg:grid-cols-[1fr_440px]">
        <div className="min-w-0">
          <AnimatePresence mode="wait">
            {step === 0 && (
              <motion.div key="area" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
                <h1 className="text-[26px] font-semibold tracking-[-0.03em]">Where would the policy apply?</h1>
                <p className="mt-1.5 max-w-xl text-[14px] text-mute">Zones are ranked by today's baseline. Coverage tells you how much the sensors can back up the result; thin coverage means a wider, more honest range.</p>
                <button
                  onClick={() => setZone("all")}
                  className={cn("mt-6 flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left ring-1 ring-inset transition-colors", zone === "all" ? "bg-brand/[0.07] ring-brand/40" : "ring-line hover:bg-white/[0.02]")}
                >
                  <MapPin className="size-4 text-brand" />
                  <span className="text-[13.5px] font-medium">All of Delhi</span>
                  <span className="text-[12px] text-mute">City-wide policies such as odd-even</span>
                  <AqiPill value={zoneBaseline("all")} className="ml-auto" />
                </button>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {zoneRows.map((z) => (
                    <button
                      key={z.id}
                      onClick={() => setZone(z.id)}
                      className={cn("group rounded-xl p-3.5 text-left ring-1 ring-inset transition-all", zone === z.id ? "bg-brand/[0.07] ring-brand/40" : "ring-line hover:bg-white/[0.02] hover:ring-line-2")}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-[13.5px] font-medium">{z.name}</div>
                          <div className="text-[11.5px] text-faint">{z.district} · {z.character}</div>
                        </div>
                        <AqiPill value={z.aqi} showLabel={false} />
                      </div>
                      <div className="mt-3 flex items-center gap-2 text-[11px] text-mute">
                        <Badge tone={z.coverage === "good" ? "ok" : z.coverage === "thin" ? "warn" : "bad"}>{z.coverage === "good" ? "Good coverage" : z.coverage === "thin" ? "Thin coverage" : "No station"}</Badge>
                        <span>{z.schools} schools · {z.hospitals} hospitals</span>
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {step === 1 && (
              <motion.div key="policy" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
                <h1 className="text-[26px] font-semibold tracking-[-0.03em]">Describe the policy in plain English</h1>
                <p className="mt-1.5 max-w-xl text-[14px] text-mute">The compiler turns it into typed parameters. Anything you don't say is marked as an assumption, never silently guessed.</p>
                <div className="mt-6 rounded-xl bg-s1 ring-1 ring-inset ring-line-2 focus-within:ring-brand/50">
                  <textarea
                    autoFocus
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && scenario && !blocking.length) setStep(2); }}
                    rows={4}
                    placeholder="e.g. Ban diesel trucks from entering Anand Vihar at night for six months starting November"
                    className="block w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-relaxed outline-none placeholder:text-faint"
                  />
                  <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
                    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-faint"><Cpu className="size-3.5" /> Constrained parser · LLM assist only for ambiguity</span>
                    <span className="flex items-center gap-1 text-[11px] text-faint"><Kbd>Ctrl</Kbd><Kbd>↵</Kbd> continue</span>
                  </div>
                </div>
                <div className="mt-4 eyebrow">Try one</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {EXAMPLES.map((ex) => (
                    <button key={ex.text} onClick={() => { setText(ex.text); const z = ZONES.find((zz) => ex.text.toLowerCase().includes(zz.name.toLowerCase())); setZone(z ? z.id : "all"); setOverrides({}); }} className="group rounded-xl p-3 text-left text-[12.5px] leading-snug text-mute ring-1 ring-inset ring-line transition-colors hover:bg-white/[0.02] hover:text-fg">
                      <Badge tone={ex.tag === "Gotcha" ? "bad" : ex.tag === "Replay" ? "violet" : "brand"} className="mb-1.5">{ex.tag}</Badge>
                      <div>{ex.text}</div>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {step === 2 && scenario && (
              <motion.div key="assume" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
                <h1 className="text-[26px] font-semibold tracking-[-0.03em]">Confirm the assumptions</h1>
                <p className="mt-1.5 max-w-xl text-[14px] text-mute">These drive the simulator. Adjust them now, or keep the defaults; every default links to the ledger row it came from.</p>
                <div className="mt-6 space-y-3">
                  {TUNABLE.map((t) => {
                    const p = scenario.params[t.key];
                    const v = Number(overrides[t.key] ?? p.value ?? 0);
                    return (
                      <div key={t.key} className="rounded-xl p-4 ring-1 ring-inset ring-line">
                        <div className="flex items-center gap-2">
                          <span className="text-[13.5px] font-medium">{p.label}</span>
                          <OriginTag origin={overrides[t.key] !== undefined ? "stated" : p.origin} />
                          {p.ledgerRef && <RefChip refId={p.ledgerRef} />}
                          <span className="ml-auto font-mono text-[14px] tabular">{t.key === "durationDays" ? `${v} days` : `${v}%`}</span>
                        </div>
                        {p.note && <div className="mt-1 text-[12px] text-faint">{p.note}</div>}
                        <input
                          type="range"
                          min={t.min}
                          max={t.max}
                          step={t.step}
                          value={v}
                          onChange={(e) => setOverrides((o) => ({ ...o, [t.key]: Number(e.target.value) }))}
                          className="mt-3 w-full accent-[#8fb3ff]"
                        />
                      </div>
                    );
                  })}
                </div>
                <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl bg-white/[0.02] p-4 text-[13px] ring-1 ring-inset ring-line">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 size-4 accent-[#8fb3ff]" />
                  <span className="text-mute">
                    I understand the output is an <span className="text-fg">estimate under stated assumptions</span>, given as a range, not a forecast. Unsourced claims will surface as open questions rather than appear in the brief.
                  </span>
                </label>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-8 flex items-center justify-between border-t border-line pt-5">
            <Button variant="ghost" onClick={() => (step === 0 ? navigate("/app") : setStep(step - 1))}>
              <ArrowLeft className="size-4" /> {step === 0 ? "Cancel" : "Back"}
            </Button>
            {step < 2 ? (
              <Button variant="primary" disabled={step === 1 && (!scenario || blocking.length > 0)} onClick={() => setStep(step + 1)}>
                Continue <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button variant="primary" size="lg" disabled={!ack} onClick={launch}>
                <Sparkles className="size-4" /> Convene the council
              </Button>
            )}
          </div>
        </div>

        {/* Right rail: live preview */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="overflow-hidden rounded-2xl bg-[radial-gradient(ellipse_at_50%_40%,#151a26_0%,#0a0b0f_75%)] ring-1 ring-inset ring-line">
            <IsoCity mode="mini" className="h-[260px]" field={field} showAfter={false} zoneId={zone} showTraffic showLabels onZoneClick={(id) => setZone(id)} />
            <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[12px]">
              <span className="text-mute">Selected</span>
              <span className="font-medium">{zone === "all" ? "All of Delhi" : ZONES.find((z) => z.id === zone)?.name}</span>
            </div>
          </div>

          <div className="rounded-2xl ring-1 ring-inset ring-line">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="flex items-center gap-2 text-[13px] font-medium"><Wand2 className="size-4 text-a-compiler" /> Compiler preview</span>
              <span className="font-mono text-[10.5px] text-faint">{scenario ? `fp ${scenario.fingerprint}` : "scenario.json"}</span>
            </div>
            {!scenario ? (
              <div className="px-4 py-8 text-center text-[12.5px] text-faint">Start typing a policy to see it parsed.</div>
            ) : (
              <div className="px-4 py-3">
                <div className="text-[13px] font-medium">{scenario.title}</div>
                <div className="mt-2.5 divide-y divide-line">
                  {(Object.keys(scenario.params) as ParamKey[]).map((k) => {
                    const p = scenario.params[k];
                    return (
                      <div key={k} className="flex items-center gap-2 py-1.5 text-[12px]">
                        <span className="w-[120px] shrink-0 text-mute">{p.label}</span>
                        <span className="min-w-0 flex-1 truncate text-right tabular">{paramDisplay(scenario, k)}</span>
                        <OriginTag origin={p.origin} />
                      </div>
                    );
                  })}
                </div>
                {scenario.warnings.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {scenario.warnings.map((w, i) => {
                      const Icon = w.level === "block" ? Ban : w.level === "warn" ? AlertTriangle : Info;
                      return (
                        <div key={i} className={cn("flex gap-2 rounded-lg px-2.5 py-2 text-[11.5px] leading-snug ring-1 ring-inset", w.level === "block" ? "bg-bad/[0.06] text-bad ring-bad/20" : w.level === "warn" ? "bg-warn/[0.06] text-warn ring-warn/20" : "bg-white/[0.03] text-mute ring-line")}>
                          <Icon className="mt-px size-3.5 shrink-0" />
                          <span>{w.text}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {unknowns.length > 0 && <div className="mt-3 text-[11.5px] text-faint">{unknowns.length} unknown parameter{unknowns.length > 1 ? "s" : ""}: you'll confirm defaults in the next step.</div>}
              </div>
            )}
          </div>

          <div className="rounded-2xl p-4 text-[12px] ring-1 ring-inset ring-line">
            <div className="flex items-center gap-2 text-[13px] font-medium"><Workflow className="size-4 text-mute" /> What runs</div>
            <ul className="mt-2.5 space-y-1.5 text-mute">
              <li className="flex justify-between"><span>Orchestrator</span><span className="text-fg">AgentCore Runtime</span></li>
              <li className="flex justify-between"><span>Scenario variants</span><span className="text-fg">Step Functions · Map ×3</span></li>
              <li className="flex justify-between"><span>Agents</span><span className="text-fg">Strands · 5 roles + verifier</span></li>
              <li className="flex justify-between"><span>Provenance</span><span className="text-fg">Lambda + DynamoDB</span></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
