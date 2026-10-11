import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, OrthographicCamera } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Pause, Play } from "lucide-react";
import { buildGeometry, useWard, type Ward } from "@/components/city/WardView";
import { Dispersion, aqiToPm, pmToAqi, type LabPolicy } from "@/lab/dispersion";
import { ENDPOINT } from "@/lib/api";
import { aqiBand, fmt } from "@/lib/aqi";
import { Segmented } from "@/components/ui/Segmented";
import { RefChip } from "@/components/ui/RichText";
import { EngineGate } from "@/components/app/EngineGate";
import { getCity } from "@/sim/city";
import { cn } from "@/lib/cn";

interface Weather { time: string[]; windSpeed: number[]; windDir: number[]; blh: number[]; row: { value: string } }

const GOOD = new THREE.Color("#4fd1b3");
const BAD = new THREE.Color("#ff4a1c");

function Field({ sim, layer, weather, idx, policy, running, onProbe }: { sim: Dispersion; layer: "level" | "change"; weather: Weather; idx: number; policy: LabPolicy; running: boolean; onProbe: (i: number | null) => void }) {
  const tex = useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array(sim.N * sim.N * 4), sim.N, sim.N, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }, [sim]);
  const col = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    const wx = { windSpeed: weather.windSpeed[idx] ?? 6, windDir: weather.windDir[idx] ?? 300, blh: weather.blh[idx] ?? 500, hour: Number((weather.time[idx] ?? "T08").slice(11, 13)) };
    if (running) for (let k = 0; k < 2; k++) sim.step(wx, policy, 45);
    const d = tex.image.data as Uint8Array;
    const N = sim.N;
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const i = iz * N + ix;
        const o = ((N - 1 - iz) * N + ix) * 4; // texture rows run south to north
        if (sim.height[i] > 0) { d[o + 3] = 0; continue; }
        const b = sim.pm(sim.base, i), p = sim.pm(sim.pol, i);
        if (layer === "level") {
          col.set(aqiBand(pmToAqi(p)).color);
          const a = Math.min(1, (p - sim.background * 0.9) / (sim.background * 0.9));
          d[o] = col.r * 255; d[o + 1] = col.g * 255; d[o + 2] = col.b * 255; d[o + 3] = 40 + Math.max(0, a) * 190;
        } else {
          const delta = b - p;
          const k = Math.min(1, Math.abs(delta) / 25);
          col.copy(delta >= 0 ? GOOD : BAD);
          d[o] = col.r * 255; d[o + 1] = col.g * 255; d[o + 2] = col.b * 255; d[o + 3] = Math.abs(delta) < 1 ? 0 : 20 + k * 220;
        }
      }
    }
    tex.needsUpdate = true;
  });
  const R = sim.R;
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0.4} onPointerMove={(e: ThreeEvent<PointerEvent>) => onProbe(sim.index(e.point.x, e.point.z))} onPointerOut={() => onProbe(null)}>
      <planeGeometry args={[R * 2, R * 2]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function Wind({ sim, weather, idx, running }: { sim: Dispersion; weather: Weather; idx: number; running: boolean }) {
  const COUNT = 1400;
  const ref = useRef<THREE.Points>(null!);
  const pos = useMemo(() => {
    const a = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) { a[i * 3] = (Math.random() * 2 - 1) * sim.R; a[i * 3 + 1] = 6 + Math.random() * 30; a[i * 3 + 2] = (Math.random() * 2 - 1) * sim.R; }
    return a;
  }, [sim]);
  useFrame((_, dt) => {
    if (!running) return;
    const speed = Math.max(0.4, (weather.windSpeed[idx] ?? 6) / 3.6) * 22; // visual time-lapse
    const toward = (((weather.windDir[idx] ?? 300) + 180) * Math.PI) / 180;
    const vx = Math.sin(toward) * speed, vz = -Math.cos(toward) * speed;
    const R = sim.R;
    for (let i = 0; i < COUNT; i++) {
      let x = pos[i * 3] + vx * dt + (Math.random() - 0.5) * 1.6;
      let z = pos[i * 3 + 2] + vz * dt + (Math.random() - 0.5) * 1.6;
      if (x < -R || x > R || z < -R || z > R) {
        // respawn on the upwind edge
        if (Math.abs(vx) > Math.abs(vz)) { x = vx > 0 ? -R : R; z = (Math.random() * 2 - 1) * R; }
        else { z = vz > 0 ? -R : R; x = (Math.random() * 2 - 1) * R; }
      }
      pos[i * 3] = x; pos[i * 3 + 2] = z;
    }
    ref.current.geometry.attributes.position.needsUpdate = true;
  });
  return (
    <points ref={ref}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[pos, 3]} /></bufferGeometry>
      <pointsMaterial color="#1c1b19" size={2.2} sizeAttenuation={false} transparent opacity={0.35} depthWrite={false} />
    </points>
  );
}

function Ward3D({ ward }: { ward: Ward }) {
  const geo = useMemo(() => buildGeometry(ward), [ward]);
  useEffect(() => () => Object.values(geo).forEach((g) => g?.dispose()), [geo]);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.2}><planeGeometry args={[ward.radius * 2.2, ward.radius * 2.2]} /><meshBasicMaterial color="#ece9e2" /></mesh>
      {geo.park && <mesh geometry={geo.park}><meshBasicMaterial color="#d4dccb" /></mesh>}
      {geo.water && <mesh geometry={geo.water}><meshBasicMaterial color="#c3d0d8" /></mesh>}
      {geo.roads && <mesh geometry={geo.roads}><meshBasicMaterial color="#d6d1c7" /></mesh>}
      {geo.buildings && <mesh geometry={geo.buildings}><meshLambertMaterial color="#fbfaf7" polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} /></mesh>}
      {geo.edges && <lineSegments geometry={geo.edges}><lineBasicMaterial color="#1c1b19" transparent opacity={0.5} /></lineSegments>}
      {ward.stations.map((s) => (
        <group key={s.name} position={[s.p[0], 0, s.p[1]]}>
          <mesh position-y={32}><cylinderGeometry args={[1.8, 1.8, 64, 8]} /><meshBasicMaterial color="#1c1b19" /></mesh>
          <mesh position-y={68}><octahedronGeometry args={[8, 0]} /><meshBasicMaterial color="#ff4a1c" /></mesh>
        </group>
      ))}
    </group>
  );
}

const fmtTime = (t?: string) => {
  if (!t) return "—";
  const d = new Date(t + ":00");
  return `${d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} · ${t.slice(11, 16)}`;
};

export default function StreetLab() {
  const { ward, state } = useWard("anandvihar");
  const [weather, setWeather] = useState<Weather | null>(null);
  const [idx, setIdx] = useState(0);
  const [play, setPlay] = useState(false);
  const [layer, setLayer] = useState<"level" | "change">("change");
  const [trucks, setTrucks] = useState<LabPolicy["trucks"]>("night");
  const [oddEven, setOddEven] = useState(false);
  const [compliance, setCompliance] = useState(0.7);
  const [stubble, setStubble] = useState(false);
  const [probe, setProbe] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const policy = useMemo<LabPolicy>(() => ({ trucks, oddEven, compliance }), [trucks, oddEven, compliance]);

  useEffect(() => {
    fetch(`${ENDPOINT}/api/weather`).then((r) => r.json()).then((w: Weather) => {
      setWeather(w);
      const firstNight = w.time.findIndex((t) => t.endsWith("T23:00"));
      setIdx(Math.max(0, firstNight));
    }).catch(() => setWeather(null));
  }, []);

  const sim = useMemo(() => {
    if (!ward || !weather) return null;
    const s = new Dispersion(ward);
    // spin up under the first morning's weather, then calibrate to the station
    const st = getCity().city.stations.find((x) => x.id === "S-AV");
    const i8 = Math.max(0, weather.time.findIndex((t) => t.endsWith("T08:00")));
    const wx = { windSpeed: weather.windSpeed[i8], windDir: weather.windDir[i8], blh: weather.blh[i8], hour: 8 };
    for (let k = 0; k < 90; k++) s.step(wx, { trucks: "none", oddEven: false, compliance: 0 }, 45);
    s.calibrate(aqiToPm(st?.aqi ?? 362));
    if (import.meta.env.DEV) (window as unknown as { __lab: Dispersion }).__lab = s;
    return s;
  }, [ward, weather]);

  // Stubble-burning day: regional smoke (Punjab/Haryana) lifts the whole floor. Peak-day share
  // rises to about 40% of PM2.5 [[L-007]]; street rules act only on the local part.
  useEffect(() => { if (sim) { sim.smoke = stubble ? sim.background * 0.9 : 0; setTick((t) => t + 1); } }, [sim, stubble]);

  // time-lapse through the real week of weather
  useEffect(() => {
    if (!play || !weather) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % weather.time.length), 1300);
    return () => clearInterval(t);
  }, [play, weather]);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 250); return () => clearInterval(t); }, []);

  const st = sim?.stats();
  const hour = weather ? Number(weather.time[idx]?.slice(11, 13)) : 0;
  const probeInfo = sim && probe !== null && probe >= 0 && sim.height[probe] === 0 ? { b: sim.pm(sim.base, probe), p: sim.pm(sim.pol, probe), road: sim.roadName[probe], canyon: sim.canyon[probe] } : null;

  return (
    <EngineGate>
      <div className="relative h-[calc(100dvh)] overflow-hidden bg-[#ece9e2]">
        {state === "missing" && <div className="grid h-full place-items-center text-[13px] text-mute">No street geometry yet. Run <code className="mx-1 font-mono">gcorp data ward anandvihar</code>.</div>}
        {ward && weather && sim && (
          <div className="absolute inset-y-0 left-0 right-[340px]">
            <Canvas dpr={[1, 1.75]} gl={{ antialias: true }} onCreated={({ gl }) => { gl.toneMapping = THREE.NoToneMapping; }}>
              <OrthographicCamera makeDefault position={[ward.radius * 1.1, ward.radius * 1.15, ward.radius * 1.1]} zoom={0.36} near={-5000} far={10000} />
              <OrbitControls makeDefault enableDamping minPolarAngle={0.3} maxPolarAngle={1.2} minZoom={0.15} maxZoom={6} />
              <hemisphereLight args={["#ffffff", "#c9c3b8", 1.25]} />
              <directionalLight position={[-400, 900, 300]} intensity={1.1} />
              <Ward3D ward={ward} />
              <Field sim={sim} layer={layer} weather={weather} idx={idx} policy={policy} running onProbe={setProbe} />
              <Wind sim={sim} weather={weather} idx={idx} running />
            </Canvas>
          </div>
        )}

        {/* controls */}
        <aside className="absolute inset-y-0 right-0 flex w-[340px] flex-col overflow-y-auto border-l border-line bg-bg">
          <div className="border-b border-line px-5 py-4">
            <div className="font-mono text-[10.5px] tracking-[0.14em] text-mute">STREET LAB · ANAND VIHAR</div>
            <h1 className="mt-1 text-[19px] font-semibold tracking-[-0.02em]">Watch a policy move through real streets</h1>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-mute">1,486 OpenStreetMap buildings, real roads, last week's real wind. Narrow streets between tall buildings trap more.</p>
          </div>

          <div className="space-y-5 px-5 py-5 text-[13px]">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-mute">Time</span>
                <button onClick={() => setPlay((p) => !p)} className="inline-flex items-center gap-1.5 text-[12px] font-medium">{play ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}{play ? "Pause" : "Play the week"}</button>
              </div>
              <div className="mt-1 font-mono text-[15px]">{fmtTime(weather?.time[idx])}</div>
              <input type="range" min={0} max={(weather?.time.length ?? 1) - 1} value={idx} onChange={(e) => setIdx(Number(e.target.value))} className="mt-2 w-full accent-black" />
              {weather && (
                <div className="mt-1 flex justify-between font-mono text-[11px] text-mute">
                  <span>wind {fmt(weather.windSpeed[idx] ?? 0, 1)} km/h from {fmt(weather.windDir[idx] ?? 0)}°</span>
                  <span>mixing {fmt(weather.blh[idx] ?? 0)} m</span>
                </div>
              )}
              <div className="mt-1 text-[11px] text-faint">Open-Meteo hourly <RefChip refId="L-024" /></div>
            </div>

            <div>
              <div className="text-mute">Truck rule</div>
              <Segmented className="mt-2" size="md" value={trucks} onChange={setTrucks} options={[{ value: "none", label: "None" }, { value: "night", label: "Night ban" }, { value: "all", label: "All-day ban" }]} />
              {trucks === "night" && !(hour >= 23 || hour < 7) && <div className="mt-1.5 text-[11.5px] text-mute">Outside 23:00–07:00 the night ban does nothing. Move the clock to see it act.</div>}
            </div>
            <label className="flex items-center justify-between">
              <span className="text-mute">Stubble-burning day <RefChip refId="L-007" /></span>
              <input type="checkbox" checked={stubble} onChange={(e) => setStubble(e.target.checked)} className="size-4 accent-black" />
            </label>
            {stubble && <div className="-mt-2 text-[11.5px] text-mute">Smoke from crop fires in Punjab and Haryana lifts the whole street. The truck ban removes the same micrograms, but they are a smaller share of a dirtier sky.</div>}
            <label className="flex items-center justify-between">
              <span className="text-mute">Odd-even for private cars</span>
              <input type="checkbox" checked={oddEven} onChange={(e) => setOddEven(e.target.checked)} className="size-4 accent-black" />
            </label>
            <div>
              <div className="flex justify-between"><span className="text-mute">Compliance</span><span className="font-mono">{Math.round(compliance * 100)}%</span></div>
              <input type="range" min={0.3} max={1} step={0.05} value={compliance} onChange={(e) => setCompliance(Number(e.target.value))} className="mt-2 w-full accent-black" />
            </div>
            <div>
              <div className="text-mute">Show</div>
              <Segmented className="mt-2" size="md" value={layer} onChange={setLayer} options={[{ value: "change", label: "Change" }, { value: "level", label: "Air level" }]} />
            </div>
          </div>

          {st && (
            <div className="mt-auto space-y-3 border-t border-line px-5 py-5 text-[13px]">
              {st.station && (
                <div>
                  <div className="text-mute">At the CPCB station</div>
                  <div className="mt-0.5 font-mono text-[18px]">AQI {fmt(pmToAqi(st.station.base))} → <span className={cn(st.station.base - st.station.pol > 0.5 && "text-[var(--color-accent)]")}>{fmt(pmToAqi(st.station.pol))}</span></div>
                </div>
              )}
              <div className="flex justify-between"><span className="text-mute">Area mean PM2.5</span><span className="font-mono">{fmt(st.meanBase)} → {fmt(st.meanPol)} µg/m³</span></div>
              {st.bestStreet && <div className="flex justify-between gap-3"><span className="text-mute">Biggest gain</span><span className="truncate text-right">{st.bestStreet.name} <span className="font-mono">−{fmt(st.bestStreet.gain)}</span></span></div>}
              {probeInfo && (
                <div className="border border-fg p-2.5 text-[12px]">
                  <div className="font-medium">{probeInfo.road ?? "Open ground"}</div>
                  <div className="mt-0.5 font-mono">PM2.5 {fmt(probeInfo.b)} → {fmt(probeInfo.p)} · AQI {fmt(pmToAqi(probeInfo.p))}</div>
                  {probeInfo.canyon > 1.05 && <div className="text-mute">street canyon ×{probeInfo.canyon.toFixed(2)}</div>}
                </div>
              )}
              <p className="text-[11px] leading-relaxed text-faint">A dispersion sandbox calibrated to the station reading (demo). It shows where a policy acts; the council's brief stays the decision record.</p>
            </div>
          )}
        </aside>
      </div>
    </EngineGate>
  );
}
