import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, OrthographicCamera } from "@react-three/drei";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { AgentId, ClaimStatus, VehicleClass } from "@/lib/types";
import { getCity } from "@/sim/city";
import { mulberry32 } from "@/sim/rng";
import { aqiBand } from "@/lib/aqi";
import { fieldTexture, makeSmogMaterial, writeField } from "./smogShader";

const { city } = getCity();
const N = city.size;
const W = (v: number) => v - N / 2 + 0.5;

export interface CityField {
  before: Float32Array;
  afterLo: Float32Array;
  afterHi: Float32Array;
  unc: Float32Array;
}

export interface CityAgent {
  id: AgentId;
  color: string;
  label: string;
}

export interface IsoCityProps {
  mode: "hero" | "app" | "mini";
  field: CityField;
  showAfter: boolean;
  layer?: "haze" | "tiles" | "delta";
  zoneId?: string | "all" | null;
  focus?: [number, number] | null;
  agents?: CityAgent[];
  activeAgent?: AgentId | null;
  verdict?: { key: string; status: ClaimStatus; at: [number, number] } | null;
  policyClass?: VehicleClass;
  showStations?: boolean;
  showLabels?: boolean;
  showTraffic?: boolean;
  showHatch?: boolean;
  follow?: boolean;
  paused?: boolean;
  className?: string;
  onZoneClick?: (zoneId: string) => void;
}

// Shared animation state lives in a ref so children can read it per frame
// without re-rendering React.
interface Anim { mix: number }

const PALETTE = {
  base: new THREE.Color("#12151b"),
  lot: new THREE.Color("#1a1e26"),
  road: new THREE.Color("#262b35"),
  arterial: new THREE.Color("#323846"),
  river: new THREE.Color("#0f2c45"),
  park: new THREE.Color("#173527"),
  open: new THREE.Color("#1d2028"),
  industrialLot: new THREE.Color("#211f1d"),
  zone: new THREE.Color("#8fb3ff"),
};

function cssVarColor(v: string) {
  if (v.startsWith("var(")) {
    const name = v.slice(4, -1);
    const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return new THREE.Color(val || "#ffffff");
  }
  return new THREE.Color(v);
}

// ---------------------------------------------------------------------------

const Ground = memo(function Ground({ layer, field, anim, zoneId }: { layer: "haze" | "tiles" | "delta"; field: CityField; anim: React.RefObject<Anim>; zoneId?: string | null }) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const lastMix = useRef(-1);
  const terrain = useMemo(
    () =>
      city.cells.map((c) => {
        const col = (c.kind === "road" ? PALETTE.road : c.kind === "arterial" ? PALETTE.arterial : c.kind === "river" ? PALETTE.river : c.kind === "park" ? PALETTE.park : c.kind === "open" ? PALETTE.open : c.kind === "industrial" ? PALETTE.industrialLot : PALETTE.lot).clone();
        if (zoneId && zoneId !== "all" && c.zone === zoneId && c.kind !== "river") col.lerp(PALETTE.zone, 0.14);
        return col;
      }),
    [zoneId],
  );

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    city.cells.forEach((c, i) => {
      const flat = c.kind === "road" || c.kind === "arterial" || c.kind === "river";
      const s = flat ? 1 : 0.94;
      const h = c.kind === "river" ? 0.04 : 0.1;
      m.compose(new THREE.Vector3(W(c.x), c.kind === "river" ? -0.07 : -h / 2, W(c.z)), new THREE.Quaternion(), new THREE.Vector3(s, h, s));
      ref.current.setMatrixAt(i, m);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  }, []);

  const tmp = useMemo(() => new THREE.Color(), []);
  const good = useMemo(() => new THREE.Color("#4fe3c1"), []);
  const bad = useMemo(() => new THREE.Color("#ff7a59"), []);
  const paint = (mix: number) => {
    city.cells.forEach((c, i) => {
      if (layer === "delta" && c.kind !== "river") {
        const d = ((field.afterLo[i] + field.afterHi[i]) / 2 - field.before[i]) * mix;
        const conf = 1 - field.unc[i] * 0.55;
        tmp.copy(terrain[i]);
        if (d < -0.5) tmp.lerp(good, Math.min(1, -d / 22) * conf);
        else if (d > 0.5) tmp.lerp(bad, Math.min(1, d / 8) * conf);
        ref.current.setColorAt(i, tmp);
      } else if (layer === "tiles" && c.kind !== "river") {
        const v = field.before[i] + ((field.afterLo[i] + field.afterHi[i]) / 2 - field.before[i]) * mix;
        tmp.set(aqiBand(v).color).multiplyScalar(c.kind === "road" || c.kind === "arterial" ? 0.55 : 0.85);
        ref.current.setColorAt(i, tmp);
      } else ref.current.setColorAt(i, terrain[i]);
    });
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  };

  useLayoutEffect(() => {
    lastMix.current = -1;
    paint(anim.current?.mix ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, terrain, field]);

  useFrame(() => {
    if (layer === "haze") return;
    const mix = anim.current?.mix ?? 0;
    if (Math.abs(mix - lastMix.current) > 0.004) {
      lastMix.current = mix;
      paint(mix);
    }
  });

  return (
    <instancedMesh ref={ref} args={[geo, undefined, city.cells.length]} receiveShadow>
      <meshStandardMaterial roughness={0.9} metalness={0.05} />
    </instancedMesh>
  );
});

const Buildings = memo(function Buildings() {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const chim = useRef<THREE.InstancedMesh>(null!);
  const items = useMemo(() => city.cells.filter((c) => c.kind === "building" || c.kind === "industrial"), []);
  const chimneys = useMemo(() => items.filter((c, i) => c.kind === "industrial" && i % 2 === 0), [items]);
  const geo = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);
    return g;
  }, []);
  const cgeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.06, 0.08, 1, 8);
    g.translate(0, 0.5, 0);
    return g;
  }, []);

  useLayoutEffect(() => {
    const rnd = mulberry32(42);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    items.forEach((c, i) => {
      const ind = c.kind === "industrial";
      const fw = ind ? 0.86 : 0.58 + rnd() * 0.24;
      const fd = ind ? 0.7 + rnd() * 0.16 : 0.58 + rnd() * 0.24;
      const ox = (rnd() - 0.5) * (0.9 - fw) * 0.8;
      const oz = (rnd() - 0.5) * (0.9 - fd) * 0.8;
      m.compose(new THREE.Vector3(W(c.x) + ox, 0, W(c.z) + oz), new THREE.Quaternion(), new THREE.Vector3(fw, c.height, fd));
      ref.current.setMatrixAt(i, m);
      if (ind) col.setHSL(0.08, 0.06, 0.34 + rnd() * 0.06);
      else col.setHSL(0.6, 0.1 + rnd() * 0.05, 0.5 + rnd() * 0.12 + Math.min(0.1, c.height * 0.02));
      ref.current.setColorAt(i, col);
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
    chimneys.forEach((c, i) => {
      m.compose(new THREE.Vector3(W(c.x) + 0.26, c.height, W(c.z) - 0.2), new THREE.Quaternion(), new THREE.Vector3(1, 0.7 + (i % 3) * 0.25, 1));
      chim.current.setMatrixAt(i, m);
    });
    chim.current.instanceMatrix.needsUpdate = true;
  }, [items, chimneys]);

  return (
    <>
      <instancedMesh ref={ref} args={[geo, undefined, items.length]} castShadow receiveShadow>
        <meshStandardMaterial roughness={0.72} metalness={0.06} />
      </instancedMesh>
      <instancedMesh ref={chim} args={[cgeo, undefined, chimneys.length]} castShadow>
        <meshStandardMaterial color="#6b625a" roughness={0.8} />
      </instancedMesh>
    </>
  );
});

const Trees = memo(function Trees() {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const spots = useMemo(() => {
    const rnd = mulberry32(5);
    const out: [number, number, number][] = [];
    for (const c of city.cells) {
      if (c.kind !== "park") continue;
      const k = 1 + Math.floor(rnd() * 3);
      for (let j = 0; j < k; j++) out.push([W(c.x) + (rnd() - 0.5) * 0.7, W(c.z) + (rnd() - 0.5) * 0.7, 0.16 + rnd() * 0.14]);
    }
    return out;
  }, []);
  const geo = useMemo(() => new THREE.IcosahedronGeometry(1, 0), []);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    const rnd = mulberry32(9);
    spots.forEach(([x, z, s], i) => {
      m.compose(new THREE.Vector3(x, s * 1.1, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(), rnd(), 0)), new THREE.Vector3(s, s * 1.3, s));
      ref.current.setMatrixAt(i, m);
      col.setHSL(0.4 + rnd() * 0.04, 0.35, 0.26 + rnd() * 0.08);
      ref.current.setColorAt(i, col);
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [spots]);
  return (
    <instancedMesh ref={ref} args={[geo, undefined, spots.length]} castShadow>
      <meshStandardMaterial roughness={0.85} flatShading />
    </instancedMesh>
  );
});

const River = memo(function River() {
  const mat = useRef<THREE.MeshStandardMaterial>(null!);
  const cells = useMemo(() => city.cells.filter((c) => c.kind === "river"), []);
  const ref = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    cells.forEach((c, i) => {
      m.compose(new THREE.Vector3(W(c.x), -0.035, W(c.z)), new THREE.Quaternion(), new THREE.Vector3(1, 0.01, 1));
      ref.current.setMatrixAt(i, m);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  }, [cells]);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.emissiveIntensity = 0.35 + Math.sin(clock.elapsedTime * 0.8) * 0.08;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, cells.length]}>
      <boxGeometry />
      <meshStandardMaterial ref={mat} color="#16466b" emissive="#0d3557" roughness={0.18} metalness={0.4} transparent opacity={0.92} />
    </instancedMesh>
  );
});

// Moving vehicles along road lanes. Trucks are amber, cars are white.
const Traffic = memo(function Traffic({ anim, zoneId, policyClass }: { anim: React.RefObject<Anim>; zoneId?: string | null; policyClass?: VehicleClass }) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const parts = useMemo(() => {
    const rnd = mulberry32(77);
    const rows = [2, 7, 12, 13, 17, 21, 22, 27];
    const cols = [1, 3, 7, 8, 13, 18, 23, 28];
    const out: { axis: 0 | 1; line: number; t: number; v: number; truck: boolean; off: number }[] = [];
    for (let i = 0; i < 190; i++) {
      const axis = (i % 2) as 0 | 1;
      const line = axis === 0 ? rows[Math.floor(rnd() * rows.length)] : cols[Math.floor(rnd() * cols.length)];
      const dir = rnd() < 0.5 ? 1 : -1;
      out.push({ axis, line, t: rnd() * N, v: dir * (0.5 + rnd() * 1.1), truck: rnd() < 0.32, off: dir * 0.17 });
    }
    return out;
  }, []);
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  useLayoutEffect(() => {
    const col = new THREE.Color();
    parts.forEach((p, i) => {
      col.set(p.truck ? "#ffb347" : "#e9eef7");
      ref.current.setColorAt(i, col);
    });
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [parts]);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const scl = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const mix = anim.current?.mix ?? 0;
    const d = Math.min(dt, 0.05);
    parts.forEach((p, i) => {
      p.t += p.v * d;
      if (p.t > N) p.t -= N;
      if (p.t < 0) p.t += N;
      const cx = p.axis === 0 ? Math.floor(p.t) : p.line;
      const cz = p.axis === 0 ? p.line : Math.floor(p.t);
      const cell = city.cells[cz * N + cx];
      let visible = !!cell && (cell.kind === "road" || cell.kind === "arterial");
      if (visible && mix > 0.5 && policyClass) {
        const inZone = zoneId === "all" || cell.zone === zoneId;
        if (inZone && policyClass === "trucks" && p.truck) visible = false;
        if (inZone && policyClass === "cars" && !p.truck && i % 2 === 0) visible = false;
      }
      const x = p.axis === 0 ? p.t : p.line + 0.5 + p.off;
      const z = p.axis === 0 ? p.line + 0.5 + p.off : p.t;
      pos.set(x - N / 2, 0.05, z - N / 2);
      const len = p.truck ? 0.28 : 0.16;
      if (visible) scl.set(p.axis === 0 ? len : 0.09, 0.07, p.axis === 0 ? 0.09 : len);
      else scl.set(0, 0, 0);
      m.compose(pos, q, scl);
      ref.current.setMatrixAt(i, m);
    });
    ref.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[geo, undefined, parts.length]}>
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
});

function Smog({ field, anim, showHatch, layers = 5 }: { field: CityField; anim: React.RefObject<Anim>; showHatch: boolean; layers?: number }) {
  const tex = useMemo(() => fieldTexture(N), []);
  useEffect(() => writeField(tex, field.before, field.afterLo, field.afterHi, field.unc), [tex, field]);
  const mats = useMemo(
    () => Array.from({ length: layers }, (_, i) => makeSmogMaterial(tex, N, i, 0.5 - i * 0.07)),
    [tex, layers],
  );
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats]);
  useFrame(({ clock }) => {
    for (const m of mats) {
      m.uniforms.uTime.value = clock.elapsedTime;
      m.uniforms.uMix.value = anim.current?.mix ?? 0;
      m.uniforms.uHatch.value = showHatch ? 1 : 0;
    }
  });
  return (
    <group>
      {mats.map((m, i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position-y={0.45 + i * 0.55} material={m} renderOrder={10 + i}>
          <planeGeometry args={[N, N]} />
        </mesh>
      ))}
    </group>
  );
}

function ZoneOutline({ zoneId }: { zoneId: string }) {
  const mat = useRef<THREE.LineBasicMaterial>(null!);
  const geo = useMemo(() => {
    const pts: number[] = [];
    const inZ = (x: number, z: number) => x >= 0 && z >= 0 && x < N && z < N && city.cells[z * N + x].zone === zoneId;
    for (const c of city.cells) {
      if (c.zone !== zoneId) continue;
      const x0 = c.x - N / 2, z0 = c.z - N / 2, y = 0.03;
      if (!inZ(c.x, c.z - 1)) pts.push(x0, y, z0, x0 + 1, y, z0);
      if (!inZ(c.x, c.z + 1)) pts.push(x0, y, z0 + 1, x0 + 1, y, z0 + 1);
      if (!inZ(c.x - 1, c.z)) pts.push(x0, y, z0, x0, y, z0 + 1);
      if (!inZ(c.x + 1, c.z)) pts.push(x0 + 1, y, z0, x0 + 1, y, z0 + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [zoneId]);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = 0.55 + Math.sin(clock.elapsedTime * 2.2) * 0.3;
  });
  return (
    <lineSegments geometry={geo} renderOrder={20}>
      <lineBasicMaterial ref={mat} color="#a9c2ff" transparent depthTest={false} />
    </lineSegments>
  );
}

function Stations() {
  return (
    <group>
      {city.stations.map((s) => {
        const color = aqiBand(s.aqi).color;
        return (
          <group key={s.id} position={[W(s.x), 0, W(s.z)]}>
            <mesh position-y={0.55}>
              <cylinderGeometry args={[0.025, 0.035, 1.1, 6]} />
              <meshStandardMaterial color="#c9d2e0" roughness={0.4} />
            </mesh>
            <mesh position-y={1.15}>
              <octahedronGeometry args={[0.13, 0]} />
              <meshBasicMaterial color={color} toneMapped={false} />
            </mesh>
            <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
              <ringGeometry args={[0.22, 0.28, 24]} />
              <meshBasicMaterial color={color} transparent opacity={0.7} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

type Anchors = React.RefObject<Map<string, THREE.Vector3>>;
type LabelEls = React.RefObject<Map<string, HTMLElement>>;

// Projects world anchors to screen and moves plain DOM labels. Cheaper and
// more predictable than one React root per label.
function LabelProjector({ anchors, els }: { anchors: Anchors; els: LabelEls }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    els.current?.forEach((el, key) => {
      const a = anchors.current?.get(key);
      if (!a) { el.style.opacity = "0"; return; }
      v.copy(a).project(camera);
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      el.style.opacity = "1";
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    });
  });
  return null;
}

function AgentPins({ agents, active, focus, anchors }: { agents: CityAgent[]; active?: AgentId | null; focus?: [number, number] | null; anchors: Anchors }) {
  const groups = useRef<Record<string, THREE.Group | null>>({});
  const rings = useRef<Record<string, THREE.Mesh | null>>({});
  const colors = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, cssVarColor(a.color)])), [agents]);
  const center = useMemo(() => new THREE.Vector3(), []);
  const tgt = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }, dt) => {
    if (!active) anchors.current?.delete("agent");
    const f = focus ?? [N / 2, N / 2];
    center.set(W(f[0]), 0, W(f[1]));
    agents.forEach((a, i) => {
      const g = groups.current[a.id];
      if (!g) return;
      if (a.id === active) tgt.copy(center);
      else {
        const ang = (i / agents.length) * Math.PI * 2 + clock.elapsedTime * 0.12;
        tgt.set(center.x + Math.cos(ang) * 3.2, 0, center.z + Math.sin(ang) * 3.2);
      }
      g.position.lerp(tgt, 1 - Math.exp(-dt * 2.6));
      const bob = Math.sin(clock.elapsedTime * 2 + i) * 0.08;
      const head = g.children[0];
      if (head) {
        head.position.y = (a.id === active ? 4.1 : 3.3) + bob;
        head.rotation.y += dt * (a.id === active ? 2 : 0.6);
      }
      if (a.id === active) anchors.current?.set("agent", new THREE.Vector3(g.position.x, 4.55, g.position.z));
      const r = rings.current[a.id];
      if (r) {
        const ph = (clock.elapsedTime * 0.9) % 1;
        const s = a.id === active ? 0.6 + ph * 2.2 : 0.5;
        r.scale.setScalar(s);
        (r.material as THREE.MeshBasicMaterial).opacity = a.id === active ? 0.8 * (1 - ph) : 0.25;
      }
    });
  });
  return (
    <group>
      {agents.map((a) => (
        <group key={a.id} ref={(el) => { groups.current[a.id] = el; }} position={[0, 0, 0]}>
          <mesh>
            <cylinderGeometry args={[0.3, 0.3, 0.14, 6]} />
            <meshBasicMaterial color={colors[a.id]} toneMapped={false} />
          </mesh>
          <mesh position-y={1.7}>
            <cylinderGeometry args={[0.018, 0.018, 3.4, 4]} />
            <meshBasicMaterial color={colors[a.id]} transparent opacity={a.id === active ? 0.75 : 0.22} toneMapped={false} />
          </mesh>
          <mesh ref={(el) => { rings.current[a.id] = el; }} rotation-x={-Math.PI / 2} position-y={0.06}>
            <ringGeometry args={[0.32, 0.4, 32]} />
            <meshBasicMaterial color={colors[a.id]} transparent opacity={0.3} toneMapped={false} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function VerdictPulse({ verdict }: { verdict: NonNullable<IsoCityProps["verdict"]> }) {
  const ref = useRef<THREE.Mesh>(null!);
  const start = useRef<number | null>(null);
  const color = verdict.status === "accepted" ? "#6ee7a8" : verdict.status === "rejected" ? "#ff6b6b" : "#f5b44a";
  useEffect(() => { start.current = null; }, [verdict.key]);
  useFrame(({ clock }) => {
    if (start.current === null) start.current = clock.elapsedTime;
    const t = Math.min(1, (clock.elapsedTime - start.current) / 1.4);
    ref.current.scale.setScalar(0.4 + t * 5);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.9;
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} position={[W(verdict.at[0]), 0.08, W(verdict.at[1])]} renderOrder={30}>
      <ringGeometry args={[0.42, 0.5, 48]} />
      <meshBasicMaterial color={color} transparent depthTest={false} toneMapped={false} />
    </mesh>
  );
}

function Diorama() {
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(N + 0.8, 0.9, N + 0.8)), []);
  return (
    <group position-y={-0.55}>
      <mesh receiveShadow>
        <boxGeometry args={[N + 0.8, 0.9, N + 0.8]} />
        <meshStandardMaterial color="#0d1015" roughness={0.95} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.08} />
      </lineSegments>
    </group>
  );
}

function Rig({ mode, focus, follow, anim, showAfter }: { mode: IsoCityProps["mode"]; focus?: [number, number] | null; follow?: boolean; anim: React.RefObject<Anim>; showAfter: boolean }) {
  const { size, camera, controls } = useThree() as unknown as { size: { width: number; height: number }; camera: THREE.OrthographicCamera; controls: { target: THREE.Vector3; update: () => void } | null };
  const fit = useMemo(() => {
    const k = mode === "hero" ? 1.0 : mode === "mini" ? 1.12 : 1.0;
    return Math.min(size.width / (N * 1.5), size.height / (N * 0.98)) * k;
  }, [size, mode]);
  useEffect(() => {
    camera.zoom = fit;
    camera.updateProjectionMatrix();
  }, [fit, camera]);
  const goal = useMemo(() => new THREE.Vector3(), []);
  const delta = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const target = showAfter ? 1 : 0;
    if (anim.current) anim.current.mix += (target - anim.current.mix) * (1 - Math.exp(-dt * 1.6));
    if (mode === "app" && follow && controls) {
      const f = focus ?? [N / 2 - 0.5, N / 2 - 0.5];
      goal.set(W(f[0]) * 0.45, 0, W(f[1]) * 0.45);
      delta.copy(goal).sub(controls.target).multiplyScalar(1 - Math.exp(-dt * 1.4));
      controls.target.add(delta);
      camera.position.add(delta);
      controls.update();
    }
  });
  return null;
}

export function IsoCity(props: IsoCityProps) {
  const { mode, field, showAfter, layer = "haze", zoneId, focus, agents, activeAgent, verdict, policyClass, showStations = true, showLabels = mode === "app", showTraffic = true, showHatch = true, follow = true, paused, className, onZoneClick } = props;
  const anim = useRef<Anim>({ mix: showAfter ? 1 : 0 });
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!host.current) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.01 });
    io.observe(host.current);
    return () => io.disconnect();
  }, []);

  const interactive = mode === "app";
  const anchors = useRef(new Map<string, THREE.Vector3>());
  const els = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    const m = anchors.current;
    for (const z of city.zones) {
      if (showLabels) m.set(`zone:${z.id}`, new THREE.Vector3(W(z.cx), zoneId === z.id ? 3.2 : 2.4, W(z.cz)));
      else m.delete(`zone:${z.id}`);
    }
  }, [showLabels, zoneId]);
  const activeMeta = agents?.find((a) => a.id === activeAgent);

  return (
    <div ref={host} className={"relative " + (className ?? "")}>
      <Canvas
        shadows
        dpr={[1, 1.75]}
        frameloop={visible && !paused ? "always" : "never"}
        gl={{ antialias: true, powerPreference: "high-performance", alpha: true }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <OrthographicCamera makeDefault position={[34, 30, 34]} near={-100} far={300} />
        <OrbitControls
          makeDefault
          enableRotate={interactive}
          enablePan={interactive}
          enableZoom={interactive}
          enableDamping
          dampingFactor={0.08}
          autoRotate={mode !== "app"}
          autoRotateSpeed={mode === "hero" ? 0.35 : 0.5}
          minPolarAngle={0.55}
          maxPolarAngle={1.08}
          screenSpacePanning
          minZoom={8}
          maxZoom={90}
        />
        <Rig mode={mode} focus={focus} follow={follow} anim={anim} showAfter={showAfter} />

        <hemisphereLight args={["#c3cfff", "#0a0c10", 0.75]} />
        <ambientLight intensity={0.12} />
        <directionalLight
          position={[-14, 26, 10]}
          intensity={2.1}
          color="#fff1e0"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-22}
          shadow-camera-right={22}
          shadow-camera-top={22}
          shadow-camera-bottom={-22}
          shadow-bias={-0.0006}
          shadow-normalBias={0.02}
        />
        <directionalLight position={[20, 10, -16]} intensity={0.55} color="#7d9bff" />

        <group>
          <Diorama />
          <Ground layer={layer} field={field} anim={anim} zoneId={zoneId} />
          <River />
          <Buildings />
          <Trees />
          {showTraffic && <Traffic anim={anim} zoneId={zoneId} policyClass={policyClass} />}
          {zoneId && zoneId !== "all" && <ZoneOutline zoneId={zoneId} />}
          {showStations && <Stations />}
          {layer !== "tiles" && <Smog field={field} anim={anim} showHatch={showHatch} layers={layer === "delta" ? 2 : mode === "mini" ? 3 : 5} />}
          {agents && agents.length > 0 && <AgentPins agents={agents} active={activeAgent} focus={focus} anchors={anchors} />}
          {verdict && <VerdictPulse key={verdict.key} verdict={verdict} />}
        </group>
        <LabelProjector anchors={anchors} els={els} />
      </Canvas>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {showLabels &&
          city.zones.map((z) => {
            const active = zoneId === z.id;
            return (
              <button
                key={z.id}
                ref={(el) => { if (el) els.current.set(`zone:${z.id}`, el); else els.current.delete(`zone:${z.id}`); }}
                onClick={() => onZoneClick?.(z.id)}
                style={{ opacity: 0 }}
                className={
                  "absolute left-0 top-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-medium tracking-tight backdrop-blur-md transition-[background,color,border-color] will-change-transform " +
                  (onZoneClick ? "pointer-events-auto cursor-pointer " : "") +
                  (active ? "border-brand/60 bg-brand/25 text-white" : "border-white/10 bg-black/50 text-white/70 hover:border-white/25 hover:text-white")
                }
              >
                {z.name}
              </button>
            );
          })}
        {activeMeta && (
          <div
            ref={(el) => { if (el) els.current.set("agent", el); else els.current.delete("agent"); }}
            style={{ opacity: 0 }}
            className="absolute left-0 top-0 whitespace-nowrap rounded-md border border-white/15 bg-black/75 px-2 py-1 text-[11px] font-medium text-white shadow-lg backdrop-blur-md will-change-transform"
          >
            <span className="mr-1.5 inline-block size-1.5 rounded-full align-middle" style={{ background: activeMeta.color }} />
            {activeMeta.label}
          </div>
        )}
      </div>
    </div>
  );
}
