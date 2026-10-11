import { useEffect, useState } from "react";
import { ArrowUpRight, Play, RotateCw, Search, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/app/AppLayout";
import { EngineGate } from "@/components/app/EngineGate";
import { Button } from "@/components/ui/Button";
import { RefChip } from "@/components/ui/RichText";
import { api, type AlertRow, type AwsStatus, type Execution, type GateResult, type KbHit, type Reading } from "@/lib/api";
import { aqiBand, fmt, relTime } from "@/lib/aqi";
import { cn } from "@/lib/cn";
import { ZONES } from "@/sim/city";

const GROUPS: { kind: "agentcore" | "bedrock" | "flow" | "data"; title: string; line: string }[] = [
  { kind: "agentcore", title: "AgentCore", line: "Where the council's rules are enforced" },
  { kind: "bedrock", title: "Bedrock", line: "A second check on every accepted claim" },
  { kind: "flow", title: "Watch loop", line: "Live air, re-assessed every hour" },
  { kind: "data", title: "Data", line: "Archive, alerts, secrets, metrics" },
];

const zoneName = (id: string) => ZONES.find((z) => z.id === id)?.name ?? id;

// Gcorp on AWS: the same engine, with its contracts enforced and its data live.
export default function Cloud() {
  const [st, setSt] = useState<AwsStatus | null>(null);
  const [readings, setReadings] = useState<{ rows: Reading[]; at: string | null } | null>(null);
  const [execs, setExecs] = useState<Execution[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [gate, setGate] = useState<GateResult[] | null>(null);
  const [gating, setGating] = useState(false);
  const [q, setQ] = useState("truck diversion after the expressway");
  const [hits, setHits] = useState<{ hits?: KbHit[]; error?: string } | null>(null);
  const [starting, setStarting] = useState(false);

  const loadLoop = () => {
    api.aws.executions().then((r) => r.ok && setExecs(r.executions)).catch(() => {});
    api.aws.alerts().then((r) => r.ok && setAlerts(r.alerts.filter((a) => a.id !== "last"))).catch(() => {});
  };
  useEffect(() => {
    api.aws.status().then(setSt).catch(() => setSt({ enabled: false }));
    api.aws.readings().then((r) => r.ok && setReadings({ rows: r.readings, at: r.updatedAt })).catch(() => {});
    loadLoop();
  }, []);

  const runGate = async () => {
    setGating(true);
    try { setGate((await api.aws.gate()).results); } finally { setGating(false); }
  };
  const search = async () => {
    const r = await api.aws.search(q);
    setHits(r.ok ? { hits: r.hits } : { error: r.error });
  };
  const runNow = async () => {
    setStarting(true);
    await api.aws.watch().catch(() => {});
    setTimeout(() => { loadLoop(); setStarting(false); }, 1500);
  };

  if (st && !st.enabled) {
    return (
      <EngineGate>
        <PageHeader title="AWS" />
        <div className="mx-auto max-w-[760px] px-6 py-16">
          <h1 className="text-[26px] font-semibold tracking-[-0.03em]">Not connected to AWS</h1>
          <p className="mt-2 text-[14px] text-mute">Gcorp runs fully offline. To enforce the council's contracts in AgentCore, ground claims with Bedrock and watch live air, provision once:</p>
          <pre className="mt-5 rounded-lg border border-line bg-s1 px-4 py-3 font-mono text-[13px]">gcorp aws up</pre>
        </div>
      </EngineGate>
    );
  }

  const rows = [...(readings?.rows ?? [])].sort((a, b) => b.aqi - a.aqi);
  const maxAqi = Math.max(400, ...rows.map((r) => r.aqi));

  return (
    <EngineGate>
      <PageHeader
        title="AWS"
        actions={st?.dashboard && (
          <a href={st.dashboard} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[12.5px] text-mute hover:text-fg">CloudWatch dashboard <ArrowUpRight className="size-3.5" /></a>
        )}
      />
      <div className="mx-auto max-w-[1180px] px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-semibold tracking-[-0.03em]">Gcorp on AWS</h1>
            <p className="mt-1.5 max-w-2xl text-[14px] text-mute">
              The same engine as offline. In AWS, the council's role contracts are enforced by AgentCore Policy, accepted claims get a second check from Bedrock Guardrails, and live Delhi air is re-assessed every hour.
            </p>
          </div>
          {st?.account && <div className="font-mono text-[11.5px] text-faint">{st.account} · {st.region}</div>}
        </div>

        {/* services */}
        <div className="mt-7 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-2 xl:grid-cols-4">
          {GROUPS.map((g) => (
            <div key={g.kind} className="bg-bg p-4">
              <div className="text-[13px] font-semibold">{g.title}</div>
              <div className="text-[12px] text-faint">{g.line}</div>
              <ul className="mt-3 space-y-2">
                {(st?.services ?? []).filter((s) => s.kind === g.kind).map((s) => (
                  <li key={s.name} className="flex gap-2 text-[12.5px]">
                    <span className={cn("mt-[5px] size-1.5 shrink-0 rounded-full", s.ok ? "bg-fg" : "bg-[var(--color-accent)]")} />
                    <span><span className="font-medium">{s.name}</span><span className="block text-[11.5px] text-mute">{s.detail}</span></span>
                  </li>
                ))}
                {!st && <li className="text-[12px] text-faint">checking…</li>}
              </ul>
            </div>
          ))}
        </div>

        {/* Cedar */}
        <section className="mt-10 grid gap-6 lg:grid-cols-[340px_1fr]">
          <div>
            <div className="font-mono text-[11px] tracking-wider text-mute">AGENTCORE POLICY · CEDAR</div>
            <h2 className="mt-2 text-[19px] font-semibold tracking-[-0.02em]">Contracts the agents can't talk their way around</h2>
            <p className="mt-2 text-[13.5px] text-mute">
              Each agent calls the gateway as its own IAM identity. Who may change which input is written in Cedar and decided by AWS, so a model that overreaches is refused before the tool runs, and the refusal is on the record.
            </p>
            <Button className="mt-4" variant="primary" onClick={runGate} disabled={gating}>
              <ShieldCheck className="size-4" /> {gating ? "Asking AgentCore…" : "Test the contracts"}
            </Button>
          </div>
          <div className="rounded-xl border border-line">
            <div className="grid grid-cols-[72px_120px_1fr] gap-3 border-b border-line px-4 py-2 font-mono text-[10.5px] tracking-wider text-faint">
              <span>DECISION</span><span>AGENT</span><span>CALL · WHY</span>
            </div>
            {(gate ?? []).map((g, i) => (
              <div key={i} className="grid grid-cols-[72px_120px_1fr] items-baseline gap-3 border-b border-line px-4 py-2.5 text-[13px] last:border-0">
                <span className={cn("font-mono text-[11.5px] font-semibold uppercase", g.decision === "permit" ? "text-fg" : "text-[var(--color-accent)]")}>{g.decision}</span>
                <span className="capitalize">{g.agent}</span>
                <span>
                  <code className="font-mono text-[12px]">{g.tool}({Object.entries(g.args).map(([k, v]) => `${k}: ${v}`).join(", ")})</code>
                  <span className="block text-[12px] text-mute">{g.why}</span>
                </span>
              </div>
            ))}
            {!gate && <div className="px-4 py-8 text-center text-[13px] text-faint">Six calls: the same tool for different agents, decided live by AgentCore.</div>}
          </div>
        </section>

        {/* live air */}
        <section className="mt-12 grid gap-6 lg:grid-cols-[340px_1fr]">
          <div>
            <div className="font-mono text-[11px] tracking-wider text-mute">LAMBDA · DYNAMODB · HOURLY</div>
            <h2 className="mt-2 text-[19px] font-semibold tracking-[-0.02em]">Delhi now</h2>
            <p className="mt-2 text-[13.5px] text-mute">
              Measured PM2.5 from OpenAQ stations where a reading is under three hours old; otherwise the CAMS model, which is coarse (about 40 km), so neighbouring zones share a value. Each row says which.
            </p>
            {readings?.at && <div className="mt-3 text-[12px] text-faint">updated {relTime(readings.at)}</div>}
          </div>
          <div className="rounded-xl border border-line">
            {rows.map((r) => {
              const b = aqiBand(r.aqi);
              return (
                <div key={r.zone} className="grid grid-cols-[130px_1fr_48px_86px] items-center gap-3 border-b border-line px-4 py-2 text-[13px] last:border-0">
                  <span>{zoneName(r.zone)}</span>
                  <span className="h-1.5 rounded-full bg-black/[0.06]"><span className="block h-full rounded-full" style={{ width: `${(r.aqi / maxAqi) * 100}%`, background: b.color }} /></span>
                  <span className="text-right font-mono text-[12.5px] tabular-nums">{fmt(r.aqi)}</span>
                  <span className={cn("text-right text-[11.5px]", r.kind === "measured" ? "font-medium text-fg" : "text-faint")} title={r.source}>{r.kind}</span>
                </div>
              );
            })}
            {!rows.length && <div className="px-4 py-8 text-center text-[13px] text-faint">No readings yet. The ingest runs every hour.</div>}
          </div>
        </section>

        {/* watch loop */}
        <section className="mt-12 grid gap-6 lg:grid-cols-[340px_1fr]">
          <div>
            <div className="font-mono text-[11px] tracking-wider text-mute">SCHEDULER · STEP FUNCTIONS · SNS</div>
            <h2 className="mt-2 text-[19px] font-semibold tracking-[-0.02em]">The watch loop</h2>
            <p className="mt-2 text-[13.5px] text-mute">
              Every hour: ingest, and where a zone crosses AQI 300 the council re-assesses the watched policy there, in parallel, then sends one alert (at most every six hours).
            </p>
            <Button className="mt-4" variant="outline" onClick={runNow} disabled={starting}><Play className="size-3.5" /> {starting ? "Starting…" : "Run now"}</Button>
          </div>
          <div className="space-y-4">
            <div className="rounded-xl border border-line">
              <div className="flex items-center justify-between border-b border-line px-4 py-2 font-mono text-[10.5px] tracking-wider text-faint">
                <span>RECENT EXECUTIONS</span>
                <button onClick={loadLoop} className="hover:text-fg" aria-label="Refresh"><RotateCw className="size-3" /></button>
              </div>
              {execs.slice(0, 6).map((x) => (
                <div key={x.name} className="flex items-center justify-between border-b border-line px-4 py-2 text-[12.5px] last:border-0">
                  <span className="font-mono text-[12px] text-mute">{x.name.slice(0, 22)}</span>
                  <span className="text-faint">{relTime(x.start)}</span>
                  <span className={cn("w-20 text-right font-mono text-[11px]", x.status === "SUCCEEDED" ? "text-fg" : x.status === "RUNNING" ? "text-mute" : "text-[var(--color-accent)]")}>{x.status.toLowerCase()}</span>
                </div>
              ))}
              {!execs.length && <div className="px-4 py-6 text-center text-[13px] text-faint">No executions yet.</div>}
            </div>
            {alerts.slice(0, 2).map((a) => {
              let out: { zone: string; range: string; grade: string }[] = [];
              try { out = JSON.parse(a.assessments ?? "[]"); } catch { /* old rows */ }
              return (
                <div key={a.id} className="rounded-xl border border-fg/80 p-4 text-[13px]">
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold">Alert · {zoneName(a.zone)} at AQI {fmt(a.aqi)} ({a.band.toLowerCase()})</span>
                    <span className="text-[12px] text-faint">{relTime(a.ts)}</span>
                  </div>
                  <div className="mt-1 text-mute">Council re-assessed “{a.policy}” where the air crossed the line:</div>
                  <ul className="mt-2 space-y-1">
                    {out.map((o) => (
                      <li key={o.zone} className="flex justify-between font-mono text-[12px]"><span>{zoneName(o.zone)}</span><span>−{o.range.split("–").map((x) => Math.round(Number(x))).join("–")} AQI · {o.grade}</span></li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        {/* knowledge base */}
        <section className="mt-12 grid gap-6 pb-16 lg:grid-cols-[340px_1fr]">
          <div>
            <div className="font-mono text-[11px] tracking-wider text-mute">BEDROCK KNOWLEDGE BASE · S3 VECTORS</div>
            <h2 className="mt-2 text-[19px] font-semibold tracking-[-0.02em]">Ask the ledger</h2>
            <p className="mt-2 text-[13.5px] text-mute">Every ledger row and role contract, embedded and searchable by meaning. Agents use it to find the right row; they still have to cite it.</p>
            {st?.model && !st.model.ok && <p className="mt-3 text-[12px] text-faint">Model access: {st.model.reason}.</p>}
          </div>
          <div>
            <form onSubmit={(e) => { e.preventDefault(); search(); }} className="flex gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} className="h-9 flex-1 rounded-lg bg-transparent px-3 text-[13.5px] ring-1 ring-inset ring-line-2 focus:outline-none focus:ring-fg" />
              <Button type="submit" variant="outline"><Search className="size-3.5" /> Search</Button>
            </form>
            <div className="mt-3 space-y-2">
              {hits?.error && <div className="rounded-lg border border-line px-4 py-3 text-[13px] text-mute">Not available yet: {hits.error}</div>}
              {hits?.hits?.map((h, i) => (
                <div key={i} className="rounded-lg border border-line px-4 py-3 text-[13px]">
                  <div className="flex items-center justify-between">{h.rowId ? <RefChip refId={h.rowId} /> : <span className="text-mute">{h.uri.split("/").pop()}</span>}<span className="font-mono text-[11px] text-faint">{h.score}</span></div>
                  <div className="mt-1 line-clamp-2 text-mute">{h.text}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </EngineGate>
  );
}
