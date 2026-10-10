import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, OrthographicCamera } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import * as THREE from "three";
import { ArrowLeft, Pause, Play, RotateCcw } from "lucide-react";
import { Director, type LogLine } from "@/council/director";
import { CouncilScene } from "@/council/World";
import { BUILDING, ROLE_PATH, ROOMS } from "@/council/layout";
import { useRunList, useRuns, useRun, finalSim } from "@/store/runs";
import { resolveRef, splitTokens } from "@/lib/refs";
import { ENDPOINT } from "@/lib/api";
import type { RunEvent } from "@/lib/types";
import { Segmented } from "@/components/ui/Segmented";
import { LogoMark } from "@/components/ui/Logo";
import { fmt } from "@/lib/aqi";
import { cn } from "@/lib/cn";

// The Council House: a separate world where the agents live. Idle, they work
// their routines; when a run plays, every engine event becomes something they
// physically do.

interface RoleCard { name: string; role: string; tools: string[]; mayChange: string[]; contract: string }

function Projector({ anchors, els }: { anchors: React.RefObject<Map<string, THREE.Vector3>>; els: React.RefObject<Map<string, HTMLElement>> }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    els.current?.forEach((el, key) => {
      const a = anchors.current?.get(key);
      if (!a) { el.style.opacity = "0"; return; }
      v.copy(a).project(camera);
      el.style.opacity = "1";
      el.style.transform = `translate3d(${((v.x * 0.5 + 0.5) * size.width).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * size.height).toFixed(1)}px, 0) translate(-50%, -100%)`;
    });
  });
  return null;
}

export default function CouncilHouse() {
  const [sp, setSp] = useSearchParams();
  const engine = useRuns((s) => s.engine);
  const connect = useRuns((s) => s.connect);
  const createRemote = useRuns((s) => s.createRemote);
  const runs = useRunList();
  const [runId, setRunId] = useState<string | null>(sp.get("run"));
  const bundle = useRun(runId ?? undefined);
  const [roles, setRoles] = useState<Record<string, RoleCard>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [speed, setSpeed] = useState("2");
  const [paused, setPaused] = useState(false);
  const [policy, setPolicy] = useState("");
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);

  const ids = useMemo(() => ROLE_PATH.map((r) => r.id), []);
  const dir = useMemo(() => new Director(ROLE_PATH.map((r) => ({ id: r.id, name: r.label }))), []);
  if (import.meta.env.DEV) (window as unknown as { __council: Director }).__council = dir;
  const anchors = useRef(new Map<string, THREE.Vector3>());
  const els = useRef(new Map<string, HTMLElement>());

  useEffect(() => { if (engine === "unknown") connect(); }, [engine, connect]);
  useEffect(() => { fetch(`${ENDPOINT}/api/council`).then((r) => r.json()).then(setRoles).catch(() => {}); }, []);
  // Pick a run once we know where runs come from; never keep an offline id once the engine answers.
  const remote = useRuns((st) => st.remote);
  useEffect(() => {
    if (engine === "unknown") return;
    if (!runs.length) return;
    if (!runId || (engine === "online" && !remote[runId])) setRunId(runs[0].id);
  }, [engine, runs, runId, remote]);

  // HUD refresh at ~8 Hz; the 3D world runs every frame on its own.
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 125); return () => clearInterval(t); }, []);

  const events: RunEvent[] = bundle?.script.events ?? [];
  const sayFor = (ev: RunEvent) => {
    if (ev.type !== "message" || !bundle) return undefined;
    const sims = bundle.sims;
    const round = Math.max(1, ...events.slice(0, events.indexOf(ev)).filter((e) => e.type === "sim").map((e) => (e as { round: number }).round));
    const ctx = { scenario: bundle.record.scenario, sim: sims[round] ?? finalSim(bundle), overrides: bundle.script.finalOverrides };
    return splitTokens(ev.text).map((p) => (typeof p === "string" ? p : resolveRef(p.ref, ctx).display)).join("");
  };

  const start = () => {
    if (!bundle) return;
    dir.play(events, sayFor, (ev) => {
      if (ev.type === "sim") {
        const sm = bundle.sims[ev.round]?.summary;
        if (sm) dir.fx.screen.range = `${fmt(sm.zoneBefore)} → ${fmt(sm.zoneAfterLo)}–${fmt(sm.zoneAfterHi)}`;
      }
      if (ev.type === "complete") dir.fx.screen.confidence = bundle.confidence?.grade;
    }, bundle.record.scenario.title);
    setPaused(false);
  };
  const playing = dir.playing;

  // Autoplay when arriving from a run (?run=…&live=1).
  useEffect(() => {
    if (bundle && sp.get("live") === "1") { start(); setSp({ run: bundle.record.id }, { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle?.record.id]);

  const convene = async () => {
    if (!policy.trim() || busy) return;
    setBusy(true);
    try {
      const id = await createRemote(policy.trim());
      setRunId(id);
      setPolicy("");
      setSp({ run: id, live: "1" });
    } finally {
      setBusy(false);
    }
  };

  const log: LogLine[] = dir.log.slice(-60);
  const sel = selected ? dir.agents[selected] : null;
  const card = selected ? roles[selected] : null;
  const s = bundle ? finalSim(bundle).summary : null;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#ece9e2] text-fg">
      {/* world: fills the space left of the activity panel */}
      <div className="absolute inset-y-0 left-0 right-[356px]">
        <Canvas shadows dpr={[1, 1.75]} gl={{ antialias: true }} onCreated={({ gl }) => { gl.toneMapping = THREE.NoToneMapping; }}>
          <OrthographicCamera makeDefault position={[BUILDING.w / 2 + 34, 38, BUILDING.d / 2 + 34]} near={-200} far={400} />
          <OrbitControls makeDefault target={[BUILDING.w / 2, 0, BUILDING.d / 2]} enableDamping minPolarAngle={0.45} maxPolarAngle={1.15} minZoom={6} maxZoom={60} />
          <hemisphereLight args={["#ffffff", "#cfc9bd", 1.35]} />
          <directionalLight position={[-20, 40, 15]} intensity={1.05} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-40} shadow-camera-right={40} shadow-camera-top={40} shadow-camera-bottom={-40} shadow-bias={-0.0004} />
          <CouncilScene dir={dir} ids={ids} selected={selected} onSelect={setSelected} speed={Number(speed)} paused={paused} anchors={anchors} />
          <Projector anchors={anchors} els={els} />
        </Canvas>
      </div>

      {/* labels projected from the world */}
      <div className="pointer-events-none absolute inset-y-0 left-0 right-[356px] overflow-hidden">
        {ROOMS.map((r) => (
          <div key={r.id} ref={(el) => { if (el) els.current.set(`room:${r.id}`, el); }} className="absolute left-0 top-0 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-[#6d6a64]" style={{ opacity: 0 }}>{r.name}</div>
        ))}
        {ids.map((id) => {
          const a = dir.agents[id];
          return (
            <div key={id} ref={(el) => { if (el) els.current.set(`agent:${id}`, el); }} className="absolute left-0 top-0 flex flex-col items-center" style={{ opacity: 0 }}>
              {a?.say && (
                <div className="mb-1.5 max-w-[240px] border border-[#1c1b19] bg-[#fbfaf7] px-2.5 py-1.5 text-[11.5px] leading-snug shadow-[3px_3px_0_0_#1c1b19]">{a.say.length > 150 ? a.say.slice(0, 147) + "…" : a.say}</div>
              )}
              {a?.label && !a.say && <div className="mb-1 bg-[#1c1b19] px-1.5 py-0.5 font-mono text-[10px] text-[#fbfaf7]">{a.label}</div>}
              <div className={cn("whitespace-nowrap rounded-sm px-1.5 py-px text-[10.5px] font-medium", selected === id ? "bg-[#ff4a1c] text-white" : "bg-[#fbfaf7]/85 text-[#1c1b19] ring-1 ring-[#1c1b19]/20")}>{a?.name ?? id}</div>
            </div>
          );
        })}
        <div ref={(el) => { if (el) els.current.set("drawer", el); }} className="absolute left-0 top-0" style={{ opacity: 0 }}>
          {dir.fx.drawer && <div className="border border-[#1c1b19] bg-[#ff4a1c] px-2 py-0.5 font-mono text-[11px] font-semibold text-white">DRAWER {dir.fx.drawer.ref}</div>}
        </div>
        <div ref={(el) => { if (el) els.current.set("stamp", el); }} className="absolute left-0 top-0" style={{ opacity: 0 }}>
          {dir.fx.stamp && (
            <div className={cn("-rotate-6 border-2 bg-[#fbfaf7] px-3 py-1 font-mono text-[15px] font-bold tracking-[0.14em]", dir.fx.stamp.status === "rejected" ? "border-[#ff4a1c] text-[#ff4a1c]" : "border-[#1c1b19] text-[#1c1b19]")}>
              {dir.fx.stamp.status === "ask" ? "[ASK]" : dir.fx.stamp.status.toUpperCase()}
            </div>
          )}
        </div>
        <div ref={(el) => { if (el) els.current.set("dial", el); }} className="absolute left-0 top-0" style={{ opacity: 0 }}>
          {dir.fx.dial && <div className="bg-[#1c1b19] px-2 py-0.5 font-mono text-[10.5px] text-white">{dir.fx.dial.label}</div>}
        </div>
      </div>

      {/* HUD: top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-4">
        <div className="pointer-events-auto flex items-center gap-3 border border-[#1c1b19] bg-[#fbfaf7] px-3 py-2">
          <Link to="/app" className="text-mute hover:text-fg" aria-label="Back to the console"><ArrowLeft className="size-4" /></Link>
          <LogoMark className="size-5" />
          <div>
            <div className="wordmark text-[14px] leading-none">gcorp</div>
            <div className="font-mono text-[10px] tracking-[0.14em] text-mute">COUNCIL HOUSE</div>
          </div>
          <span className="mx-1 h-7 w-px bg-line-2" />
          <select value={runId ?? ""} onChange={(e) => { setRunId(e.target.value); dir.stop(); }} className="h-8 max-w-[300px] bg-transparent text-[12.5px] outline-none">
            {runs.map((r) => <option key={r.id} value={r.id}>{r.scenario.title}</option>)}
          </select>
          <button onClick={start} disabled={!bundle} className="inline-flex h-8 items-center gap-1.5 bg-[#1c1b19] px-3 text-[12.5px] font-medium text-[#fbfaf7] disabled:opacity-40">
            {playing ? <RotateCcw className="size-3.5" /> : <Play className="size-3.5" />} {playing ? "Restart" : "Convene this run"}
          </button>
        </div>
        <div className="pointer-events-auto flex items-center gap-2 border border-[#1c1b19] bg-[#fbfaf7] px-2 py-1.5">
          <button onClick={() => setPaused((p) => !p)} className="grid size-7 place-items-center hover:bg-black/5" aria-label={paused ? "Resume" : "Pause"}>{paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}</button>
          <Segmented value={speed} onChange={setSpeed} options={[{ value: "0.5", label: "0.5×" }, { value: "1", label: "1×" }, { value: "2", label: "2×" }, { value: "4", label: "4×" }]} />
          <span className={cn("ml-1 flex items-center gap-1.5 pr-1 text-[11px]", engine === "online" ? "text-fg" : "text-mute")}><span className={cn("size-1.5 rounded-full", engine === "online" ? "bg-[#ff4a1c]" : "bg-faint")} />{engine === "online" ? "engine live" : "offline"}</span>
        </div>
      </div>

      {/* HUD: activity log */}
      <div className="pointer-events-auto absolute bottom-4 right-4 top-20 flex w-[340px] flex-col border border-[#1c1b19] bg-[#fbfaf7]/95">
        <div className="flex items-center justify-between border-b border-[#1c1b19]/15 px-3 py-2">
          <span className="font-mono text-[10.5px] tracking-[0.14em] text-mute">WHAT THE COUNCIL IS DOING</span>
          <span className="font-mono text-[10.5px] text-mute">✓{dir.fx.trays.accepted} ✗{dir.fx.trays.rejected} ?{dir.fx.trays.ask}</span>
        </div>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-2.5 text-[12px] leading-snug" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
          {log.length === 0 && <div className="py-8 text-center text-mute">The council is in recess. Pick a run and convene it, or type a new policy below.</div>}
          {log.map((l, i) => (
            <div key={i} className="flex gap-2">
              <button onClick={() => setSelected(l.agent)} className="w-[92px] shrink-0 truncate text-left font-medium hover:underline">{ROLE_PATH.find((r) => r.id === l.agent)?.label ?? l.agent}</button>
              <span className={cn("min-w-0", l.tone === "reject" && "text-[#ff4a1c]", l.tone === "accept" && "text-fg", l.tone === "ask" && "italic text-mute", !l.tone && "text-mute", (l.tone === "sim" || l.tone === "param") && "text-fg")}>{l.text}</span>
            </div>
          ))}
        </div>
        <form className="border-t border-[#1c1b19]/15 p-2.5" onSubmit={(e) => { e.preventDefault(); convene(); }}>
          <div className="flex items-center gap-2 border border-[#1c1b19] bg-white px-2.5">
            <input value={policy} onChange={(e) => setPolicy(e.target.value)} disabled={engine !== "online" || busy} placeholder={engine === "online" ? "Bring a new policy to the council…" : "Start the engine to convene"} className="h-9 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint" />
            <button type="submit" disabled={!policy.trim() || busy || engine !== "online"} className="text-[12px] font-medium disabled:text-faint">{busy ? "…" : "Convene"}</button>
          </div>
        </form>
      </div>

      {/* HUD: result + selected agent */}
      <div className="pointer-events-none absolute bottom-4 left-4 flex flex-col gap-3">
        {sel && (
          <div className="pointer-events-auto w-[330px] border border-[#1c1b19] bg-[#fbfaf7] p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[15px] font-semibold">{sel.name}</div>
                <div className="text-[12px] text-mute">{card?.role}</div>
              </div>
              <button onClick={() => setSelected(null)} className="font-mono text-[11px] text-mute hover:text-fg">close</button>
            </div>
            <div className="mt-2.5 font-mono text-[10.5px] tracking-wide text-mute">NOW · {sel.anim.toUpperCase()}{sel.label ? ` · ${sel.label}` : ""}</div>
            {card && (
              <div className="mt-2 text-[11.5px] text-mute">
                <div>tools: <span className="font-mono text-fg">{card.tools.join(", ") || "—"}</span></div>
                <div>may change: <span className="font-mono text-fg">{card.mayChange.join(", ") || "nothing"}</span></div>
              </div>
            )}
            <div className="mt-2.5 max-h-[120px] space-y-0.5 overflow-y-auto border-t border-[#1c1b19]/15 pt-2 text-[11.5px] text-mute">
              {sel.log.length ? sel.log.slice().reverse().map((l, i) => <div key={i} className="truncate">· {l}</div>) : <div>No actions yet in this session.</div>}
            </div>
          </div>
        )}
        {s && (
          <div className="pointer-events-auto border border-[#1c1b19] bg-[#fbfaf7] px-3.5 py-2.5">
            <div className="font-mono text-[10px] tracking-[0.14em] text-mute">{bundle?.record.scenario.params.zone.value?.toString().toUpperCase()} · FINAL RANGE</div>
            <div className="mt-1 font-mono text-[20px] font-semibold">{fmt(s.zoneBefore)} → {fmt(s.zoneAfterLo)}–{fmt(s.zoneAfterHi)}</div>
            <div className="text-[11.5px] text-mute">confidence {bundle?.confidence?.grade ?? "—"} · a range, not a forecast</div>
            {runId && <Link to={`/app/runs/${runId}/brief`} className="mt-1.5 inline-block text-[12px] font-medium underline underline-offset-4">Read the brief</Link>}
          </div>
        )}
        <div className="pointer-events-auto font-mono text-[10px] text-mute">drag to orbit · scroll to zoom · click an agent</div>
      </div>
    </div>
  );
}
