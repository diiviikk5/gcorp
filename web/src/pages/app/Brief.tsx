import { Link, useParams } from "react-router";
import { ArrowLeft, Link2, Printer, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { HourlyBars } from "@/components/ui/Hourly";
import { api, type RunCloud, type SensorAdvice } from "@/lib/api";
import { zoneById } from "@/sim/city";
import { PageHeader } from "@/components/app/AppLayout";
import { Button } from "@/components/ui/Button";
import { RefChip, RichText } from "@/components/ui/RichText";
import { RangeBar } from "@/components/ui/Aqi";
import { finalSim, useRun } from "@/store/runs";
import { recommend } from "@/lib/recommend";
import { AGENTS } from "@/sim/council";
import { paramDisplay } from "@/lib/refs";
import type { Claim, ParamKey } from "@/lib/types";
import { fmt } from "@/lib/aqi";
import { cn } from "@/lib/cn";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line py-7">
      <h2 className="text-[12px] font-medium text-mute">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function Brief() {
  const { id } = useParams();
  const b = useRun(id);
  const [copied, setCopied] = useState(false);
  const [sensors, setSensors] = useState<SensorAdvice | null>(null);
  useEffect(() => { if (b?.remote && b.record.scenario.zoneId !== "all") api.sensors(b.record.id).then(setSensors).catch(() => setSensors(null)); }, [b?.remote, b?.record.id, b?.record.scenario.zoneId]);
  if (!b) return <div className="p-10 text-mute">Brief not found.</div>;

  const rec = b.record;
  const sc = rec.scenario;
  const sim = finalSim(b);
  const s = sim.summary;
  const ctx = { scenario: sc, sim, overrides: b.script.finalOverrides };
  const r = recommend(b);
  const claims = Object.values(b.script.claims);
  const accepted = claims.filter((c) => c.status === "accepted");
  const asks = claims.filter((c) => c.status === "ask");
  const rejected = claims.filter((c) => c.status === "rejected");
  const assumed = (Object.keys(sc.params) as ParamKey[]).filter((k) => sc.params[k].origin !== "stated" || b.script.finalOverrides[k] !== undefined);
  const cited = Array.from(new Set(accepted.map((c) => c.ledgerRef).filter(Boolean))) as string[];

  return (
    <div>
      <PageHeader
        title="Brief"
        crumbs={
          <div className="flex items-center gap-1.5 text-[13px]">
            <Link to={`/app/runs/${rec.id}`} className="flex items-center gap-1 text-mute hover:text-fg"><ArrowLeft className="size-3.5" /> Run</Link>
            <span className="text-faint">/</span>
            <span className="font-medium">brief.md</span>
          </div>
        }
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard?.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 1400); }}>
              <Link2 className="size-3.5" /> {copied ? "Copied" : "Copy link"}
            </Button>
            {b.remote && <Listen runId={rec.id} />}
            <Button size="sm" variant="secondary" onClick={() => window.print()}><Printer className="size-3.5" /> Print</Button>
          </>
        }
      />

      <article className="mx-auto max-w-[720px] px-6 pb-24 pt-12">
        <div className="font-mono text-[11px] text-faint">
          {new Date(rec.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · fingerprint <RefChip refId="fp" ctx={ctx} runId={rec.id} />
        </div>
        <h1 className="mt-3 text-[30px] font-semibold leading-tight tracking-[-0.03em]">{sc.title}</h1>
        <p className="mt-2 text-[14px] text-mute">“{sc.text}”</p>

        <div className="mt-8 rounded-xl border border-line p-6">
          <div className={cn("text-[13px] font-medium", r.verdict === "reject" ? "text-bad" : "text-fg")}>{r.label}</div>
          <p className="mt-1 text-[14px] text-mute">{r.line}</p>
          <div className="mt-6 text-[22px] leading-snug tracking-[-0.02em]">
            Under these assumptions, the estimated reduction is <RefChip refId="sim:deltaRange" ctx={ctx} runId={rec.id} /> AQI points{" "}
            <span className="text-mute">(<RefChip refId="sim:pctRange" ctx={ctx} runId={rec.id} />)</span>.
          </div>
          <RangeBar className="mt-5" before={s.zoneBefore} lo={s.zoneAfterLo} hi={s.zoneAfterHi} min={Math.max(0, s.zoneBefore - 120)} max={s.zoneBefore + 20} />
          <div className="mt-1 flex justify-between font-mono text-[11px] text-faint">
            <span>{sc.zoneId === "all" ? "city mean" : `${sc.params.zone.value} mean`}</span>
            <span>{fmt(s.zoneBefore)} → {fmt(s.zoneAfterLo)}–{fmt(s.zoneAfterHi)}</span>
          </div>
          {rec.observed && (
            <div className="mt-4 flex justify-between border-t border-line pt-3 text-[13px]">
              <span className="text-mute">{rec.observed.label}</span>
              <RefChip refId={rec.observed.ledgerRef} runId={rec.id} />
            </div>
          )}
        </div>

        {b.confidence && (
          <Section title="How sure are we">
            <div className="flex items-baseline gap-3">
              <span className={cn("text-[22px] font-semibold tracking-tight", b.confidence.grade === "Low" && "text-bad")}>{b.confidence.grade}</span>
              <span className="font-mono text-[12px] text-mute">score {b.confidence.score.toFixed(2)}{b.confidence.highVariance ? " · high variance" : ""}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2.5 sm:grid-cols-4">
              {([["Sensor coverage", b.confidence.components.coverage], ["Verified sources", b.confidence.components.sources], ["Stated inputs", b.confidence.components.assumptions], ["Stability under debate", b.confidence.components.stability]] as const).map(([k, v]) => (
                <div key={k}>
                  <div className="text-[11.5px] text-mute">{k}</div>
                  <div className="mt-1 h-1 rounded-full bg-black/[0.07]"><div className="h-1 rounded-full bg-fg" style={{ width: `${Math.round(v * 100)}%` }} /></div>
                </div>
              ))}
            </div>
            {b.confidence.reasons.length > 0 && (
              <ul className="mt-4 space-y-1 text-[13.5px] text-mute">{b.confidence.reasons.map((r) => <li key={r}>· {r}</li>)}</ul>
            )}
          </Section>
        )}

        {s.hourly && s.hourly.some((v) => v > 0) && (
          <Section title="When the policy acts (mid estimate, AQI points by hour)">
            <HourlyBars values={s.hourly} highlight={(() => { const i = s.hourly!.indexOf(Math.max(...s.hourly!)); return [i, i + 1] as [number, number]; })()} height={90} />
          </Section>
        )}

        {sensors && sensors.candidates[0] && (
          <Section title="Where one more sensor helps most">
            <p className="text-[14px] leading-relaxed">
              One sensor (<RefChip refId={sensors.unitCostRef} />) near cell ({sensors.candidates[0].x}, {sensors.candidates[0].z}) in {zoneById(sensors.zone)?.name ?? sensors.zone} narrows this decision's uncertainty band by about <strong>{Math.round(sensors.candidates[0].reduction * 100)}%</strong>.
            </p>
            <p className="mt-1 text-[12.5px] text-mute">Value of information: the simulator re-runs with a hypothetical station at each candidate cell and keeps the one that shrinks the band most.</p>
          </Section>
        )}

        {b.cloud && <CloudChecks cloud={b.cloud} claims={accepted} />}

        <Section title="Findings (accepted claims only)">
          <ul className="space-y-3">
            {accepted.map((c) => (
              <li key={c.id} className="grid grid-cols-[110px_1fr] gap-3 text-[14px] leading-relaxed">
                <span className="text-mute">{AGENTS[c.agent].name}</span>
                <span>
                  <RichText text={c.text} ctx={ctx} runId={rec.id} />
                  <CloudMarks claim={c} />
                </span>
              </li>
            ))}
          </ul>
        </Section>

        {asks.length > 0 && (
          <Section title="Open questions for the planner">
            <ul className="space-y-2 text-[14px] leading-relaxed">
              {asks.map((c) => (
                <li key={c.id} className="flex gap-3">
                  <span className="font-mono text-[12px] text-mute">[ASK]</span>
                  <span>{c.text} <span className="text-mute">No source yet.</span></span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Assumptions and limitations">
          <ul className="space-y-2 text-[14px]">
            {assumed.map((k) => (
              <li key={k} className="flex justify-between gap-4 border-b border-line pb-2">
                <span className="text-mute">{sc.params[k].label}</span>
                <span className="tabular">{b.script.finalOverrides[k] !== undefined ? <RefChip refId={`param:${k}`} ctx={ctx} runId={rec.id} /> : paramDisplay(sc, k)}</span>
              </li>
            ))}
            {s.coverage !== "good" && <li className="text-mute">Sensor coverage in this zone is {s.coverage}; the range is wider as a result.</li>}
            <li className="text-mute">The grid model estimates direction and rough magnitude, not precise AQI. This is not a forecast.</li>
          </ul>
        </Section>

        {rejected.length > 0 && (
          <Section title="Excluded from this brief">
            <ul className="space-y-3 text-[14px]">
              {rejected.map((c) => (
                <li key={c.id}>
                  <span className="text-mute line-through decoration-bad/70">{c.text}</span>
                  <div className="mt-0.5 text-[12.5px] text-mute"><span className="text-bad">Rejected.</span> <RichText text={c.reason ?? ""} ctx={ctx} runId={rec.id} /></div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Sources">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {cited.map((cid) => <RefChip key={cid} refId={cid} runId={rec.id} className="font-mono !text-[12px]" />)}
          </div>
        </Section>
      </article>
    </div>
  );
}


function CloudMarks({ claim }: { claim: Claim }) {
  const g = claim.grounding?.scores?.grounding;
  if (!g && !claim.gate) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-x-3 font-mono text-[11px] text-faint">
      {g && <span className={cn(g.score < g.threshold && "text-[var(--color-accent)]")} title="Bedrock Guardrails contextual grounding against the cited rows">
        {g.score < g.threshold ? "weakly grounded" : "grounded"} {g.score.toFixed(2)}
      </span>}
      {claim.gate && <span className={cn(claim.gate.decision !== "permit" && "text-[var(--color-accent)]")} title={claim.gate.engine}>
        cedar: {claim.gate.decision} {claim.gate.key}
      </span>}
    </span>
  );
}

function CloudChecks({ cloud, claims }: { cloud: RunCloud; claims: Claim[] }) {
  const graded = claims.filter((c) => c.grounding?.scores?.grounding);
  const weak = graded.filter((c) => c.grounding!.scores!.grounding!.score < c.grounding!.scores!.grounding!.threshold);
  const gates = claims.filter((c) => c.gate);
  const lines: string[] = [];
  if (cloud.host) lines.push(`Ran on AgentCore Runtime in ${cloud.host.seconds}s${cloud.fingerprintsMatch ? "; re-simulated here, fingerprints match" : ""}.`);
  if (gates.length) lines.push(`${gates.length} parameter change${gates.length > 1 ? "s" : ""} decided by AgentCore Policy (Cedar): ${gates.filter((c) => c.gate!.decision === "permit").length} permitted.`);
  if (graded.length) lines.push(`Bedrock Guardrails grounding: ${graded.length - weak.length} of ${graded.length} accepted claims say what their sources say` + (weak.length ? `; ${weak.length} marked weakly grounded below.` : "."));
  const back = cloud.host?.backends ?? cloud.backends;
  if (back && Object.values(back).some((v) => v.startsWith("bedrock"))) lines.push("Drafted by a Bedrock model; every claim still passed the verifier.");
  if (!lines.length) return null;
  return (
    <Section title="Checked in AWS">
      <ul className="space-y-1.5 text-[14px] leading-relaxed">{lines.map((l) => <li key={l}>· {l}</li>)}</ul>
    </Section>
  );
}

function Listen({ runId }: { runId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "off">("idle");
  const [audio] = useState(() => (typeof Audio !== "undefined" ? new Audio() : null));
  useEffect(() => () => audio?.pause(), [audio]);
  if (state === "off" || !audio) return null;
  const play = () => {
    if (state === "playing") { audio.pause(); setState("idle"); return; }
    setState("loading");
    audio.src = api.aws.audioUrl(runId);
    audio.onplaying = () => setState("playing");
    audio.onended = () => setState("idle");
    audio.onerror = () => setState("off");
    audio.play().catch(() => setState("off"));
  };
  return (
    <Button size="sm" variant="ghost" onClick={play} title="Spoken brief (Amazon Polly, en-IN)">
      <Volume2 className="size-3.5" /> {state === "loading" ? "Preparing…" : state === "playing" ? "Stop" : "Listen"}
    </Button>
  );
}

