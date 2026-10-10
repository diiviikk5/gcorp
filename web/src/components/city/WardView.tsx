import { Canvas } from "@react-three/fiber";
import { OrbitControls, OrthographicCamera } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ENDPOINT } from "@/lib/api";
import { aqiBand } from "@/lib/aqi";

// Real Anand Vihar: OpenStreetMap footprints extruded in metres, drawn like
// an architect's model: white volumes, ink edges, roads as flat ribbons.

export interface Ward {
  zone: string;
  center: [number, number];
  radius: number;
  retrievedAt: string;
  buildings: { p: [number, number][]; h: number; t?: string }[];
  roads: { p: [number, number][]; w: number; n?: string }[];
  green: { p: [number, number][]; k: "water" | "park" }[];
  stations: { name: string; p: [number, number] }[];
}

export function useWard(zone: string | null) {
  const [ward, setWard] = useState<Ward | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "missing">("idle");
  useEffect(() => {
    if (!zone || zone === "all") { setState("missing"); return; }
    setState("loading");
    fetch(`${ENDPOINT}/api/ward/${zone}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((w: Ward) => { setWard(w); setState("ready"); })
      .catch(() => setState("missing"));
  }, [zone]);
  return { ward, state };
}

function shapeOf(p: [number, number][]) {
  const s = new THREE.Shape();
  p.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z)));
  return s;
}

function buildGeometry(w: Ward) {
  const blds: THREE.BufferGeometry[] = [];
  for (const b of w.buildings) {
    if (b.p.length < 3) continue;
    const g = new THREE.ExtrudeGeometry(shapeOf(b.p), { depth: b.h, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    blds.push(g);
  }
  const buildings = blds.length ? mergeGeometries(blds, false) : null;
  blds.forEach((g) => g.dispose());
  const edges = buildings ? new THREE.EdgesGeometry(buildings, 25) : null;

  const ribbons: THREE.BufferGeometry[] = [];
  for (const r of w.roads) {
    for (let i = 0; i < r.p.length - 1; i++) {
      const [x1, z1] = r.p[i], [x2, z2] = r.p[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.5) continue;
      const g = new THREE.PlaneGeometry(len + r.w * 0.5, r.w);
      g.rotateX(-Math.PI / 2);
      g.rotateY(-Math.atan2(z2 - z1, x2 - x1));
      g.translate((x1 + x2) / 2, 0.15, (z1 + z2) / 2);
      ribbons.push(g);
    }
  }
  const roads = ribbons.length ? mergeGeometries(ribbons, false) : null;
  ribbons.forEach((g) => g.dispose());

  const greens = { park: [] as THREE.BufferGeometry[], water: [] as THREE.BufferGeometry[] };
  for (const gpoly of w.green) {
    if (gpoly.p.length < 3) continue;
    const g = new THREE.ShapeGeometry(shapeOf(gpoly.p));
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.08, 0);
    greens[gpoly.k].push(g);
  }
  const park = greens.park.length ? mergeGeometries(greens.park, false) : null;
  const water = greens.water.length ? mergeGeometries(greens.water, false) : null;
  return { buildings, edges, roads, park, water };
}

export function WardView({ ward, aqi, showAfter, afterAqi, className }: { ward: Ward; aqi: number; showAfter: boolean; afterAqi: number; className?: string }) {
  const geo = useMemo(() => buildGeometry(ward), [ward]);
  useEffect(() => () => Object.values(geo).forEach((g) => g?.dispose()), [geo]);
  const v = showAfter ? afterAqi : aqi;
  const haze = new THREE.Color(aqiBand(v).color).lerp(new THREE.Color("#8a847a"), 0.55);
  const R = ward.radius;

  return (
    <div className={className}>
      <Canvas dpr={[1, 1.75]} gl={{ antialias: true }} onCreated={({ gl }) => { gl.toneMapping = THREE.NoToneMapping; }}>
        <OrthographicCamera makeDefault position={[R * 1.2, R * 1.1, R * 1.2]} zoom={0.42} near={-5000} far={10000} />
        <OrbitControls makeDefault enableDamping minPolarAngle={0.35} maxPolarAngle={1.2} minZoom={0.15} maxZoom={6} />
        <hemisphereLight args={["#ffffff", "#b9b3a8", 1.15]} />
        <directionalLight position={[-400, 900, 300]} intensity={1.3} />
        <mesh rotation-x={-Math.PI / 2} position-y={-0.2}>
          <planeGeometry args={[R * 2.2, R * 2.2]} />
          <meshBasicMaterial color="#ece9e2" />
        </mesh>
        {geo.park && <mesh geometry={geo.park}><meshBasicMaterial color="#d4dccb" /></mesh>}
        {geo.water && <mesh geometry={geo.water}><meshBasicMaterial color="#c3d0d8" /></mesh>}
        {geo.roads && <mesh geometry={geo.roads}><meshBasicMaterial color="#d6d1c7" /></mesh>}
        {geo.buildings && (
          <mesh geometry={geo.buildings}>
            <meshLambertMaterial color="#fbfaf7" polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
          </mesh>
        )}
        {geo.edges && (
          <lineSegments geometry={geo.edges}>
            <lineBasicMaterial color="#1c1b19" transparent opacity={0.55} />
          </lineSegments>
        )}
        {ward.stations.map((s) => (
          <group key={s.name} position={[s.p[0], 0, s.p[1]]}>
            <mesh position-y={30}><cylinderGeometry args={[1.6, 1.6, 60, 8]} /><meshBasicMaterial color="#121110" /></mesh>
            <mesh position-y={64}><octahedronGeometry args={[7, 0]} /><meshBasicMaterial color="#ff4a1c" /></mesh>
          </group>
        ))}
        {/* smog: two thin translucent layers, density tied to AQI */}
        {[38, 70].map((y, i) => (
          <mesh key={y} rotation-x={-Math.PI / 2} position-y={y}>
            <circleGeometry args={[R * 1.02, 64]} />
            <meshBasicMaterial color={haze} transparent opacity={Math.min(0.16, (v / 500) * 0.2) * (i ? 0.6 : 1)} depthWrite={false} />
          </mesh>
        ))}
      </Canvas>
    </div>
  );
}
