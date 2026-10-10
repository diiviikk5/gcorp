import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { motion, useInView } from "motion/react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { useRef } from "react";
import { HeroFigure, HERO_CLAIMS } from "@/components/landing/HeroFigure";
import { PIPE, PipelineFigure } from "@/components/landing/PipelineFigure";
import { ArchFigure } from "@/components/landing/ArchFigure";
import { LogoMark } from "@/components/ui/Logo";
import { compile } from "@/sim/compiler";
import { simulate } from "@/sim/simulator";
import { withOverrides } from "@/store/runs";
import { fmt } from "@/lib/aqi";
import { cn } from "@/lib/cn";

const FLAGSHIP = "Ban diesel trucks from entering Anand Vihar at night for six months starting November";
const LIVE_RUN = "/app/runs/r-e9bdd6?live=1";

function useFlagship() {
  return useMemo(() => {
    const sc = compile({ text: FLAGSHIP, zoneId: "anandvihar" });
    return simulate(withOverrides(sc, { leakagePct: 30, compliancePct: 55 }), 2).summary;
  }, []);
}

const rise = { initial: { opacity: 0, y: 16 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-80px" }, transition: { duration: 0.7, ease: [0.2, 0.7, 0.2, 1] as const } };

function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div className="mx-auto mt-3 flex h-12 max-w-[1240px] items-center justify-between rounded-full border border-[var(--edge)] bg-[rgb(11_10_9/0.7)] px-3 pl-4 backdrop-blur-xl">
        <Link to="/" className="flex items-center gap-2 text-[14px] font-medium tracking-tight">
          <LogoMark className="size-5" /> Gcorp
        </Link>
        <nav className="hidden items-center gap-7 text-[13px] text-[var(--ink)] md:flex">
          <a href="#how" className="hover:text-[var(--ink-hi)]">How it works</a>
          <a href="#receipts" className="hover:text-[var(--ink-hi)]">Receipts</a>
          <a href="#replay" className="hover:text-[var(--ink-hi)]">Replay</a>
          <a href="#stack" className="hover:text-[var(--ink-hi)]">Stack</a>
        </nav>
        <Link to="/app" className="btn-accent inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors">
          Open console <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </header>
  );
}

function Hero() {
  const s = useFlagship();
  const [policy, setPolicy] = useState(false);
  const [turn, setTurn] = useState(0);
  const lines = useMemo(() => Array.from({ length: 3 }, (_, k) => HERO_CLAIMS[(turn + k) % HERO_CLAIMS.length]), [turn]);

  useEffect(() => {
    const t = window.setTimeout(() => setPolicy(true), 3800);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <section className="relative min-h-[100svh] overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_68%_48%,rgb(255_154_46/0.10),transparent_70%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[var(--bg)] to-transparent" />

      <div className="relative mx-auto grid max-w-[1320px] items-center gap-6 px-6 pt-28 lg:min-h-[100svh] lg:grid-cols-[minmax(0,500px)_1fr] lg:pt-16">
        <div className="relative z-10">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="inline-flex items-center gap-2 rounded-full border border-[var(--edge)] px-3 py-1 font-mono text-[11px] tracking-wider text-[var(--ink)]">
            <span className="size-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_10px_var(--accent)]" /> TRACK 01 · AIR · DELHI
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.1, ease: [0.2, 0.7, 0.2, 1] }}
            className="mt-6 text-[clamp(44px,6.4vw,84px)] font-semibold leading-[0.95] tracking-[-0.045em]"
          >
            Test an air policy <span className="glow-text">before</span> the city pays for it.
          </motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, delay: 0.35 }} className="mt-6 max-w-[460px] text-[17px] leading-relaxed text-[var(--ink)]">
            Type a policy in plain English. A council of AI agents argues whether it works, a verifier strikes any claim it can't trace to a source, and the city shows the change as an honest range.
          </motion.p>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, delay: 0.5 }} className="mt-9 flex flex-wrap items-center gap-3">
            <Link to="/app/new" className="btn-accent inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14.5px] font-medium transition-colors">
              Pre-check a policy <ArrowRight className="size-4" />
            </Link>
            <Link to={LIVE_RUN} className="btn-line inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14.5px] transition-shadow">
              Watch a live run
            </Link>
          </motion.div>
        </div>

        <div className="relative -mx-6 lg:-mr-24 lg:ml-0">
          <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.4, ease: [0.2, 0.7, 0.2, 1] }} className="aspect-[1.25] w-full">
            <HeroFigure policy={policy} onTurn={setTurn} />
          </motion.div>

          {/* Policy switch + readout */}
          <div className="absolute bottom-6 right-6 flex flex-col items-end gap-2 lg:right-28">
            <button
              onClick={() => setPolicy((p) => !p)}
              className="flex items-center gap-3 rounded-full border border-[var(--edge)] bg-[rgb(11_10_9/0.75)] py-1.5 pl-3.5 pr-1.5 text-[12.5px] backdrop-blur-md transition-colors hover:border-[var(--line)]"
              aria-pressed={policy}
            >
              <span className="text-[var(--ink)]">Night truck ban</span>
              <span className={cn("relative h-5 w-9 rounded-full transition-colors", policy ? "bg-[var(--accent)]" : "bg-[var(--detail)]")}>
                <span className={cn("absolute top-0.5 size-4 rounded-full bg-[var(--ink-hi)] transition-transform", policy ? "translate-x-[18px]" : "translate-x-0.5")} />
              </span>
            </button>
            <div className="rounded-xl border border-[var(--edge)] bg-[rgb(11_10_9/0.75)] px-3.5 py-2.5 text-right font-mono text-[11.5px] leading-relaxed text-[var(--ink)] backdrop-blur-md">
              <div>anand vihar · zone mean</div>
              <div className="text-[15px] text-[var(--ink-hi)]">
                aqi {fmt(s.zoneBefore)} <span className="text-[var(--ink)]">→</span>{" "}
                <span className={policy ? "glow-text" : ""}>{policy ? `${fmt(s.zoneAfterLo)}–${fmt(s.zoneAfterHi)}` : fmt(s.zoneBefore)}</span>
              </div>
              <div className="text-[10.5px]">a range under stated assumptions</div>
            </div>
          </div>

          {/* Council ticker */}
          <div className="absolute bottom-6 left-6 hidden w-[360px] rounded-2xl border border-[var(--edge)] bg-[rgb(11_10_9/0.8)] p-3.5 backdrop-blur-md sm:block lg:left-2">
            <div className="mb-2 flex items-center justify-between font-mono text-[10.5px] tracking-wider text-[var(--ink)]">
              <span>COUNCIL · LIVE</span>
              <span className="flex items-center gap-1.5"><span className="size-1.5 animate-pulse rounded-full bg-[var(--accent)]" /> verifying</span>
            </div>
            <div className="space-y-2">
              {lines.map((c, i) => (
                <motion.div key={`${turn}-${i}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: i === 2 ? 1 : 0.55, y: 0 }} transition={{ duration: 0.4 }} className="flex gap-2 text-[12px] leading-snug">
                  <span className="w-[86px] shrink-0 text-[var(--ink)]">{c.agent}</span>
                  <span className={cn("min-w-0 flex-1", c.status === "rejected" && "text-[var(--ink)] line-through decoration-[var(--accent)]")}>
                    {c.text} {c.ref && <span className="text-[var(--accent-hi)] underline decoration-dotted underline-offset-2">{c.ref}</span>}
                  </span>
                  <span className={cn("shrink-0 font-mono text-[10px]", c.status === "rejected" ? "text-[var(--accent)]" : "text-[var(--ink)]")}>
                    {c.status === "accepted" ? "✓ src" : c.status === "rejected" ? "✗ no src" : "[ask]"}
                  </span>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section className="mx-auto max-w-[1240px] px-6 py-28 md:py-40">
      <motion.p {...rise} className="max-w-[980px] text-[clamp(30px,4.2vw,56px)] font-medium leading-[1.08] tracking-[-0.035em] text-[var(--ink-hi)]">
        Every winter, Delhi argues about air policies nobody has tested.{" "}
        <span className="text-[var(--ink)]">Consultants take months. Debates run on numbers no one checked. And nobody says how sure they are.</span>
      </motion.p>
    </section>
  );
}

function How() {
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-20%" });
  useEffect(() => {
    if (!inView) return;
    const id = window.setInterval(() => setActive((a) => (a + 1) % PIPE.length), 1800);
    return () => window.clearInterval(id);
  }, [inView]);
  const copy = [
    "The compiler turns your sentence into typed parameters. Anything you didn't say is marked as an assumption.",
    "A deterministic grid model, not an agent, estimates the change per cell, as a range, with an input fingerprint.",
    "Engineer, epidemiologist, economist and a skeptic on a different model attack the inputs. Each objection names what it would change.",
    "The verifier checks sourcing only. Accepted, rejected, or [ASK]. Accepted objections re-run the simulator.",
    "The brief is written from accepted claims only. Gaps become stated limitations, not footnotes.",
  ];
  return (
    <section id="how" ref={ref} className="border-t border-[var(--edge)]">
      <div className="mx-auto max-w-[1240px] px-6 py-28">
        <motion.div {...rise} className="flex items-end justify-between gap-6">
          <h2 className="text-[clamp(28px,3.4vw,44px)] font-semibold tracking-[-0.035em]">Five stages. Every one writes a file.</h2>
          <span className="hidden font-mono text-[11px] tracking-wider text-[var(--ink)] md:block">FIG 02 · RUNS/&lt;RUN-ID&gt;/</span>
        </motion.div>
        <motion.div {...rise} className="mt-14">
          <PipelineFigure active={active} onPick={setActive} />
        </motion.div>
        <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-[var(--edge)] bg-[var(--edge)] md:grid-cols-5">
          {PIPE.map((p, i) => (
            <button key={p.id} onClick={() => setActive(i)} className={cn("bg-[var(--bg)] p-5 text-left transition-colors", i === active ? "bg-[var(--panel)]" : "hover:bg-[var(--panel)]")}>
              <div className="flex items-center justify-between font-mono text-[10.5px] tracking-wider">
                <span className={i === active ? "text-[var(--accent)]" : "text-[var(--ink)]"}>0{i + 1}</span>
                <span className="text-[var(--line)]">{p.file}</span>
              </div>
              <div className="mt-3 text-[15px] font-medium capitalize">{p.id}</div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--ink)]">{copy[i]}</p>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function Receipts() {
  const [open, setOpen] = useState<number | null>(0);
  const rows = [
    { agent: "Engineer", claim: "Through-traffic reroutes; diversion after the expressway opened was", value: "30%", status: "accepted", src: "L-011 · Traffic study, East Delhi corridors · retrieved 2026-10-08" },
    { agent: "Engineer", claim: "Trucks are the largest source here. This cuts PM2.5 by about a third.", value: null, status: "rejected", src: "No ledger row supports a zone-level figure. L-002 is city-wide: scope mismatch. Number removed." },
    { agent: "Epidemiologist", claim: "This should prevent asthma admissions.", value: null, status: "ask", src: "No local dose-response data (L-022). Surfaced to the planner as an open question; kept out of the brief." },
  ];
  return (
    <section id="receipts" className="border-t border-[var(--edge)]">
      <div className="mx-auto grid max-w-[1240px] gap-14 px-6 py-28 lg:grid-cols-[1fr_1.1fr]">
        <motion.div {...rise}>
          <span className="font-mono text-[11px] tracking-wider text-[var(--ink)]">FIG 03 · THE VERIFIER</span>
          <h2 className="mt-4 text-[clamp(28px,3.4vw,44px)] font-semibold leading-[1.05] tracking-[-0.035em]">
            Numbers come from the simulator and the ledger. <span className="text-[var(--ink)]">Never from the agents.</span>
          </h2>
          <p className="mt-5 max-w-md text-[15.5px] leading-relaxed text-[var(--ink)]">
            If an agent could produce a figure, the verifier would have nothing to check. So agents argue about assumptions, and every number on screen links to the row it came from.
          </p>
        </motion.div>
        <motion.div {...rise} className="overflow-hidden rounded-2xl border border-[var(--edge)] bg-[var(--panel)]">
          {rows.map((r, i) => (
            <button key={i} onClick={() => setOpen(open === i ? null : i)} className="block w-full border-b border-[var(--edge)] px-5 py-4 text-left last:border-b-0">
              <div className="flex items-center justify-between font-mono text-[10.5px] tracking-wider">
                <span className="text-[var(--ink)]">{r.agent.toUpperCase()}</span>
                <span className={r.status === "rejected" ? "text-[var(--accent)]" : "text-[var(--ink)]"}>{r.status === "accepted" ? "ACCEPTED" : r.status === "rejected" ? "REJECTED" : "[ASK]"}</span>
              </div>
              <div className={cn("mt-2 text-[15px] leading-snug", r.status === "rejected" && "text-[var(--ink)] line-through decoration-[var(--accent)]")}>
                {r.claim} {r.value && <span className="text-[var(--accent-hi)] underline decoration-dotted underline-offset-4">{r.value}</span>}
              </div>
              <motion.div initial={false} animate={{ height: open === i ? "auto" : 0, opacity: open === i ? 1 : 0 }} className="overflow-hidden">
                <div className="mt-3 rounded-lg border border-dashed border-[var(--line)] px-3 py-2 font-mono text-[11.5px] leading-relaxed text-[var(--ink)]">{r.src}</div>
              </motion.div>
            </button>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function Honest() {
  const s = useFlagship();
  const pct = (v: number) => ((v - (s.zoneBefore - 80)) / 100) * 100;
  return (
    <section className="border-t border-[var(--edge)]">
      <div className="mx-auto grid max-w-[1240px] gap-px px-6 py-28 md:grid-cols-3">
        {[
          {
            k: "A range, not a forecast",
            v: (
              <div className="relative mt-8 h-10">
                <div className="absolute inset-x-0 top-1/2 h-px bg-[var(--line)]" />
                <div className="absolute top-1/2 h-4 -translate-y-1/2 rounded-sm border border-[var(--accent)] bg-[repeating-linear-gradient(135deg,rgb(255_154_46/0.35)_0_2px,transparent_2px_6px)]" style={{ left: `${pct(s.zoneAfterLo)}%`, width: `${pct(s.zoneAfterHi) - pct(s.zoneAfterLo)}%` }} />
                <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--ink-hi)]" style={{ left: `${pct(s.zoneBefore)}%` }} />
                <div className="absolute -bottom-3 font-mono text-[10.5px] text-[var(--ink)]" style={{ left: `${pct(s.zoneAfterLo)}%` }}>{fmt(s.zoneAfterLo)}–{fmt(s.zoneAfterHi)}</div>
                <div className="absolute -bottom-3 -translate-x-1/2 font-mono text-[10.5px] text-[var(--ink-hi)]" style={{ left: `${pct(s.zoneBefore)}%` }}>{fmt(s.zoneBefore)}</div>
              </div>
            ),
            d: "“Under these assumptions, the estimated reduction is X to Y.” Never a crisp number the model can't justify.",
          },
          {
            k: "Thin data looks thin",
            v: <div className="mt-8 h-10 rounded-md bg-[repeating-linear-gradient(135deg,rgb(141_134_127/0.4)_0_2px,transparent_2px_7px)] [mask-image:linear-gradient(90deg,transparent,black_30%,black)]" />,
            d: "Where sensors are sparse, the band widens and the map is hatched instead of looking confident.",
          },
          {
            k: "It can say no",
            v: <div className="mt-8 font-mono text-[13px] leading-relaxed text-[var(--ink)]"><span className="text-[var(--ink-hi)] line-through decoration-[var(--accent)]">Ban diesel autos in ITO</span><br /><span className="text-[var(--accent)]">→ fleet is CNG · effect ≈ 0</span></div>,
            d: "Delhi's autos already run on CNG. The tool flags it before a single agent speaks.",
          },
        ].map((c) => (
          <motion.div key={c.k} {...rise} className="border-[var(--edge)] p-6 md:border-l md:first:border-l-0">
            <div className="text-[17px] font-medium tracking-tight">{c.k}</div>
            {c.v}
            <p className="mt-8 text-[14px] leading-relaxed text-[var(--ink)]">{c.d}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function Replay() {
  const predicted = useMemo(() => {
    const sc = compile({ text: "Run odd-even for private cars across Delhi for 15 days in January 2016" });
    return simulate(withOverrides(sc, { leakagePct: 25, compliancePct: 55 }), 2).summary;
  }, []);
  const obs = [1, 3];
  const max = 6;
  return (
    <section id="replay" className="border-t border-[var(--edge)]">
      <div className="mx-auto grid max-w-[1240px] items-center gap-14 px-6 py-28 lg:grid-cols-2">
        <motion.div {...rise}>
          <span className="font-mono text-[11px] tracking-wider text-[var(--ink)]">REPLAY · ODD-EVEN, JAN 2016</span>
          <h2 className="mt-4 text-[clamp(28px,3.4vw,44px)] font-semibold leading-[1.05] tracking-[-0.035em]">Checked against what actually happened.</h2>
          <p className="mt-5 max-w-md text-[15.5px] leading-relaxed text-[var(--ink)]">
            Run a past policy through the same pipeline and compare the estimate with the observed change. One honest replay is worth more than ten features.
          </p>
        </motion.div>
        <motion.div {...rise} className="rounded-2xl border border-[var(--edge)] bg-[var(--panel)] p-6">
          {[
            { k: "Gcorp estimate", lo: predicted.pctLo, hi: predicted.pctHi, accent: true },
            { k: "Observed (evaluations)", lo: obs[0], hi: obs[1], accent: false },
          ].map((r) => (
            <div key={r.k} className="py-4">
              <div className="flex items-baseline justify-between">
                <span className="text-[14px]">{r.k}</span>
                <span className="font-mono text-[13px] text-[var(--ink)]">−{fmt(r.lo, 1)}% to −{fmt(r.hi, 1)}%</span>
              </div>
              <div className="relative mt-3 h-2 rounded-full bg-[var(--detail)]">
                <div className={cn("absolute inset-y-0 rounded-full", r.accent ? "bg-[var(--accent)] shadow-[0_0_14px_var(--accent)]" : "bg-[var(--ink)]")} style={{ left: `${(r.lo / max) * 100}%`, width: `${Math.max(1.5, ((r.hi - r.lo) / max) * 100)}%` }} />
              </div>
            </div>
          ))}
          <div className="mt-2 flex justify-between font-mono text-[10px] text-[var(--line)]">
            <span>0%</span><span>PM2.5 reduction</span><span>−{max}%</span>
          </div>
          <p className="mt-4 text-[11.5px] text-[var(--line)]">Demo values for the prototype. Ledger rows L-016 to L-018.</p>
        </motion.div>
      </div>
    </section>
  );
}

function Stack() {
  const items = [
    ["Strands Agents SDK", "Council and verifier orchestration"],
    ["Bedrock AgentCore Runtime", "One endpoint hosts the orchestrator; the UI makes one call"],
    ["Step Functions · Map", "Scenario variants in parallel for the confidence band"],
    ["Lambda + DynamoDB", "The provenance ledger every claim is checked against"],
  ];
  return (
    <section id="stack" className="border-t border-[var(--edge)]">
      <div className="mx-auto max-w-[1240px] px-6 py-28">
        <motion.div {...rise} className="flex items-end justify-between gap-6">
          <h2 className="text-[clamp(28px,3.4vw,44px)] font-semibold tracking-[-0.035em]">AWS only where it adds value.</h2>
          <span className="hidden font-mono text-[11px] tracking-wider text-[var(--ink)] md:block">FIG 04 · WHERE IT RUNS</span>
        </motion.div>
        <div className="mt-12 grid items-center gap-12 lg:grid-cols-[1.4fr_1fr]">
          <motion.div {...rise}><ArchFigure /></motion.div>
          <motion.ul {...rise} className="divide-y divide-[var(--edge)] border-y border-[var(--edge)]">
            {items.map(([k, v]) => (
              <li key={k} className="py-4">
                <div className="text-[15px] font-medium">{k}</div>
                <div className="mt-0.5 text-[13.5px] text-[var(--ink)]">{v}</div>
              </li>
            ))}
          </motion.ul>
        </div>
      </div>
    </section>
  );
}

function Final() {
  return (
    <section className="relative overflow-hidden border-t border-[var(--edge)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_70%_at_50%_100%,rgb(255_154_46/0.14),transparent_70%)]" />
      <div className="relative mx-auto max-w-[1240px] px-6 py-36 text-center">
        <motion.h2 {...rise} className="text-[clamp(40px,6vw,80px)] font-semibold leading-[0.98] tracking-[-0.045em]">
          What would you <span className="glow-text">have done?</span>
        </motion.h2>
        <motion.div {...rise} className="mt-10 flex justify-center gap-3">
          <Link to="/app/new" className="btn-accent inline-flex h-12 items-center gap-2 rounded-full px-6 text-[15px] font-medium transition-colors">
            Pre-check a policy <ArrowRight className="size-4" />
          </Link>
          <Link to="/app" className="btn-line inline-flex h-12 items-center rounded-full px-6 text-[15px] transition-shadow">Open console</Link>
        </motion.div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--edge)]">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-4 px-6 py-8 text-[12px] text-[var(--ink)]">
        <span className="flex items-center gap-2"><LogoMark className="size-4" /> Gcorp · prototype on demo data</span>
        <a href="https://iso-glow.vercel.app" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--line)] hover:text-[var(--ink)]">
          Made with ISO-GLOW <ArrowUpRight className="size-3" />
        </a>
      </div>
    </footer>
  );
}

export default function Landing() {
  return (
    <div className="landing min-h-screen">
      <Nav />
      <Hero />
      <Problem />
      <How />
      <Receipts />
      <Honest />
      <Replay />
      <Stack />
      <Final />
      <Footer />
    </div>
  );
}
