import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Database, Fingerprint, ShieldAlert, SlidersHorizontal, Sigma, X } from "lucide-react";
import { useEffect } from "react";
import { ledgerById } from "@/data/ledger";
import { useUi } from "@/store/ui";
import { useRun } from "@/store/runs";
import { usePlayback, derive, eventIndex } from "@/store/playback";
import { resolveRef } from "@/lib/refs";
import type { ParamKey } from "@/lib/types";
import { SECTOR_SHARE } from "@/sim/simulator";
import { AGENTS } from "@/sim/council";
import { Badge } from "../ui/Badge";
import { OriginTag } from "../ui/Origin";
import { RefChip, RichText } from "../ui/RichText";

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 border-t border-line py-2.5 text-[13px]">
      <div className="text-mute">{k}</div>
      <div className="min-w-0 break-words text-fg">{children}</div>
    </div>
  );
}

export function ProvenanceSheet() {
  const target = useUi((s) => s.provenance);
  const close = useUi((s) => s.closeProvenance);
  const bundle = useRun(target?.runId);
  const elapsed = usePlayback((s) => (s.runId === target?.runId ? s.elapsed : Infinity));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  let body: React.ReactNode = null;
  let title = "";
  let Icon = Database;

  if (target) {
    const ref = target.ref;
    const d = bundle ? derive(bundle, eventIndex(bundle.script.events, elapsed)) : null;
    const round = d?.simRound || 2;
    const sim = bundle?.sims[round];
    const ctx = bundle ? { scenario: bundle.record.scenario, sim, overrides: d?.params } : undefined;
    const citedBy = bundle ? Object.values(bundle.script.claims).filter((c) => c.text.includes(`[[${ref}]]`) || c.ledgerRef === ref) : [];

    if (ref.startsWith("L-")) {
      const row = ledgerById(ref);
      Icon = Database;
      title = `Ledger row ${ref}`;
      body = row ? (
        <>
          <div className="text-[13px] text-mute">{row.label}</div>
          <div className="mt-2 text-[28px] font-semibold tracking-tight tabular">
            {row.value}
            {row.unit && <span className="ml-2 text-[13px] font-normal text-mute">{row.unit}</span>}
          </div>
          {row.status === "demo" && (
            <div className="mt-4 flex gap-2.5 rounded-lg bg-warn/[0.07] p-3 text-[12.5px] leading-relaxed text-warn ring-1 ring-inset ring-warn/20">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              Demo value, shaped like a real ledger row. Replace it with the retrieved figure before showing this to a planner.
            </div>
          )}
          <div className="mt-5">
            <Row k="Source">{row.source}</Row>
            <Row k="URL">
              <a href={row.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                {row.url.replace("https://", "")} <ArrowUpRight className="size-3" />
              </a>
            </Row>
            <Row k="Scope">{row.scope}</Row>
            <Row k="Retrieved"><span className="font-mono text-[12px]">{row.retrievedAt}</span></Row>
            {row.note && <Row k="Note">{row.note}</Row>}
          </div>
        </>
      ) : (
        <div className="text-bad">No ledger row with this id. A claim citing it would be rejected.</div>
      );
    } else if (ref.startsWith("sim:") && bundle && sim) {
      Icon = Sigma;
      title = "Simulator output";
      const cls = bundle.record.scenario.vehicleClass;
      body = (
        <>
          <div className="text-[13px] text-mute">Round {round} · deterministic grid model</div>
          <div className="mt-2 text-[28px] font-semibold tracking-tight tabular">{resolveRef(ref, ctx).display}</div>
          <p className="mt-3 text-[13px] leading-relaxed text-mute">
            Computed by the simulator, not by an agent. Same inputs give the same output; the fingerprint below proves which inputs were used.
          </p>
          <div className="mt-5">
            <Row k="Fingerprint"><span className="font-mono text-[12px]">{sim.fingerprint}</span></Row>
            <Row k="Apportionment">
              {SECTOR_SHARE[cls].refs.map((r) => <RefChip key={r} refId={r} runId={target.runId} ctx={ctx} />)}
            </Row>
            <Row k="Inputs">
              <div className="flex flex-wrap gap-y-1">
                {(["targetedShare", "reductionPct", "compliancePct", "leakagePct", "durationDays"] as ParamKey[]).map((k) => (
                  <span key={k} className="mr-2 text-[12.5px] text-mute">
                    {bundle.record.scenario.params[k].label}
                    <RefChip refId={`param:${k}`} ctx={ctx} runId={target.runId} />
                  </span>
                ))}
              </div>
            </Row>
            <Row k="Coverage">{sim.summary.coverage} · mean band ±{(sim.summary.bandWidth / 2).toFixed(1)} AQI</Row>
          </div>
        </>
      );
    } else if (ref.startsWith("param:") && bundle) {
      Icon = SlidersHorizontal;
      const key = ref.slice(6) as ParamKey;
      const p = bundle.record.scenario.params[key];
      const changed = d?.params[key] !== undefined;
      title = "Scenario parameter";
      body = (
        <>
          <div className="flex items-center gap-2 text-[13px] text-mute">
            {p.label} <OriginTag origin={changed ? "assumed" : p.origin} />
          </div>
          <div className="mt-2 text-[28px] font-semibold tracking-tight tabular">{resolveRef(ref, ctx).display}</div>
          <div className="mt-5">
            {changed && <Row k="Changed by">An accepted objection during the debate (was {String(p.value)}{p.unit === "%" ? "%" : ""}).</Row>}
            {p.note && <Row k="Note">{p.note}</Row>}
            {p.ledgerRef && <Row k="Default from"><RefChip refId={p.ledgerRef} runId={target.runId} ctx={ctx} /></Row>}
            <Row k="Scenario">{bundle.record.scenario.title}</Row>
          </div>
        </>
      );
    } else if (ref === "fp") {
      Icon = Fingerprint;
      title = "Input fingerprint";
      body = (
        <>
          <div className="mt-1 font-mono text-[24px] tracking-tight">{resolveRef(ref, ctx).display}</div>
          <p className="mt-3 text-[13px] leading-relaxed text-mute">
            A hash of every simulator input. Verdicts are bound to it: change the policy and every old verdict goes stale.
          </p>
        </>
      );
    }

    if (citedBy.length > 0 && body) {
      body = (
        <>
          {body}
          <div className="mt-6 eyebrow">Cited in this run</div>
          <div className="mt-2 space-y-2">
            {citedBy.map((c) => (
              <div key={c.id} className="rounded-lg bg-black/[0.03] p-3 text-[12.5px] leading-relaxed ring-1 ring-inset ring-line">
                <div className="mb-1 flex items-center gap-2">
                  <span className="size-1.5 rounded-full" style={{ background: AGENTS[c.agent].color }} />
                  <span className="font-medium">{AGENTS[c.agent].name}</span>
                  <Badge tone={c.status === "accepted" ? "ok" : c.status === "rejected" ? "bad" : "warn"}>{c.status}</Badge>
                </div>
                <RichText text={c.text} ctx={ctx} runId={target.runId} className="text-mute" />
              </div>
            ))}
          </div>
        </>
      );
    }
  }

  return (
    <AnimatePresence>
      {target && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-black/15" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
          <motion.aside
            className="fixed inset-y-2 right-2 z-50 flex w-[420px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-2xl border border-line-2 bg-s1/95 shadow-2xl backdrop-blur-xl"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: "spring", bounce: 0, duration: 0.35 }}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <div className="flex items-center gap-2 text-[13px] font-medium">
                <Icon className="size-4 text-brand" />
                {title}
              </div>
              <button onClick={close} className="rounded-md p-1 text-mute hover:bg-black/5 hover:text-fg" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5">{body}</div>
            <div className="border-t border-line px-5 py-3 text-[11.5px] text-faint">Provenance ledger · Lambda + DynamoDB</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
