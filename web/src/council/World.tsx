import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Director } from "./director";
import { BUILDING, CABINETS, DESKS, DOORS, DOOR_W, ROOMS, SPOTS, TABLE, seat, type V2 } from "./layout";

const INK = "#1c1b19";
const PAPER = "#fbfaf7";
const ACCENT = "#ff4a1c";
const WALL_LOW = 1.25;
const WALL_HIGH = 3.0;

// --------------------------------------------------------------------------- primitives

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const boxEdges = new THREE.EdgesGeometry(boxGeo);
const inkLine = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.55 });

export function Block({ x, z, w, d, h, y = 0, color = PAPER, edges = true, cast = true }: { x: number; z: number; w: number; d: number; h: number; y?: number; color?: string; edges?: boolean; cast?: boolean }) {
  return (
    <group position={[x, y + h / 2, z]} scale={[w, h, d]}>
      <mesh geometry={boxGeo} castShadow={cast} receiveShadow>
        <meshLambertMaterial color={color} />
      </mesh>
      {edges && <lineSegments geometry={boxEdges} material={inkLine} />}
    </group>
  );
}

function Cyl({ x, z, r, h, y = 0, color = PAPER, seg = 24 }: { x: number; z: number; r: number; h: number; y?: number; color?: string; seg?: number }) {
  const geo = useMemo(() => new THREE.CylinderGeometry(r, r, h, seg), [r, h, seg]);
  const edges = useMemo(() => new THREE.EdgesGeometry(geo, 30), [geo]);
  return (
    <group position={[x, y + h / 2, z]}>
      <mesh geometry={geo} castShadow receiveShadow><meshLambertMaterial color={color} /></mesh>
      <lineSegments geometry={edges} material={inkLine} />
    </group>
  );
}

/** A wall along one axis, split around door gaps. */
function Wall({ axis, at, from, to, h, gaps = [] }: { axis: "x" | "z"; at: number; from: number; to: number; h: number; gaps?: number[] }) {
  const segs: [number, number][] = [];
  let cur = from;
  for (const g of [...gaps].sort((a, b) => a - b)) {
    const a = g - DOOR_W / 2, b = g + DOOR_W / 2;
    if (a > cur) segs.push([cur, a]);
    cur = b;
  }
  if (cur < to) segs.push([cur, to]);
  return (
    <>
      {segs.map(([a, b], i) =>
        axis === "x" ? (
          <Block key={i} x={at} z={(a + b) / 2} w={0.16} d={b - a} h={h} />
        ) : (
          <Block key={i} x={(a + b) / 2} z={at} w={b - a} d={0.16} h={h} />
        ),
      )}
    </>
  );
}

const doorsOn = (axis: "x" | "z", at: number) => DOORS.filter((d) => d.axis === axis && Math.abs((axis === "x" ? d.at[0] : d.at[1]) - at) < 0.01).map((d) => (axis === "x" ? d.at[1] : d.at[0]));

function Building() {
  return (
    <group>
      {/* slab */}
      <Block x={BUILDING.w / 2} z={BUILDING.d / 2} w={BUILDING.w + 1.2} d={BUILDING.d + 1.2} h={0.4} y={-0.4} color="#e6e2d9" cast={false} />
      {ROOMS.map((r) => (
        <mesh key={r.id} position={[(r.x0 + r.x1) / 2, 0.005, (r.z0 + r.z1) / 2]} rotation-x={-Math.PI / 2} receiveShadow>
          <planeGeometry args={[r.x1 - r.x0 - 0.1, r.z1 - r.z0 - 0.1]} />
          <meshLambertMaterial color={r.tint} />
        </mesh>
      ))}
      {/* outer walls: full height at the back, low at the front (cutaway) */}
      <Wall axis="z" at={0} from={0} to={BUILDING.w} h={WALL_HIGH} />
      <Wall axis="x" at={0} from={0} to={BUILDING.d} h={WALL_HIGH} />
      <Wall axis="z" at={BUILDING.d} from={0} to={BUILDING.w} h={0.45} gaps={[SPOTS.door[0]]} />
      <Wall axis="x" at={BUILDING.w} from={0} to={BUILDING.d} h={0.45} />
      {/* windows on the back walls */}
      {[4, 9, 18, 24, 30, 40, 45].map((x) => <Block key={`w${x}`} x={x} z={0.12} w={2.4} d={0.1} h={1.2} y={1.2} color="#d8e0e4" />)}
      {/* partitions */}
      <Wall axis="x" at={14} from={0} to={24} h={WALL_LOW} gaps={doorsOn("x", 14)} />
      <Wall axis="z" at={14} from={0} to={14} h={WALL_LOW} gaps={doorsOn("z", 14)} />
      <Wall axis="z" at={24} from={0} to={36} h={WALL_LOW} gaps={doorsOn("z", 24)} />
      <Wall axis="z" at={9} from={14} to={36} h={WALL_LOW} gaps={doorsOn("z", 9)} />
      <Wall axis="x" at={26} from={0} to={9} h={WALL_LOW} />
      <Wall axis="x" at={36} from={0} to={32} h={WALL_LOW} gaps={doorsOn("x", 36)} />
      <Wall axis="z" at={12} from={36} to={48} h={WALL_LOW} gaps={doorsOn("z", 12)} />
    </group>
  );
}

function Desk({ at, long = false }: { at: V2; long?: boolean }) {
  const [x, z] = at;
  return (
    <group>
      <Block x={x} z={z} w={long ? 4.2 : 1.8} d={0.8} h={0.76} />
      <Block x={x} z={z - 0.22} w={0.8} d={0.06} h={0.5} y={0.76} color="#2a2826" edges={false} />
      <Block x={x} z={z + 1.1} w={0.55} d={0.55} h={0.46} color="#e8e4dc" />
    </group>
  );
}

function Plant({ x, z }: { x: number; z: number }) {
  return (
    <group>
      <Cyl x={x} z={z} r={0.28} h={0.5} color="#e8e4dc" />
      <mesh position={[x, 0.95, z]} castShadow><icosahedronGeometry args={[0.45, 0]} /><meshLambertMaterial color="#9fb39a" flatShading /></mesh>
    </group>
  );
}

// --------------------------------------------------------------------------- live furniture

function Furniture({ dir }: { dir: Director }) {
  const drawers = useRef<(THREE.Mesh | null)[]>([]);
  const machineLight = useRef<THREE.MeshBasicMaterial>(null!);
  const modelBlocks = useRef<THREE.Group>(null!);
  const dial = useRef<THREE.Mesh>(null!);
  const stamp = useRef<THREE.Group>(null!);
  const printerLight = useRef<THREE.MeshBasicMaterial>(null!);
  const okStack = useRef<THREE.Mesh>(null!);
  const noStack = useRef<THREE.Mesh>(null!);

  const model = useMemo(() => {
    let s = 3;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: 20 }, (_, i) => ({ x: (i % 5) * 0.5 - 1, z: Math.floor(i / 5) * 0.4 - 0.6, h: 0.1 + r() * 0.5 }));
  }, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const fx = dir.fx;
    drawers.current.forEach((m, i) => {
      if (!m) return;
      const open = fx.drawer?.index === i;
      m.position.x += ((open ? -0.75 : -0.05) - m.position.x) * 0.2;
      (m.material as THREE.MeshLambertMaterial).color.set(open ? ACCENT : "#e8e4dc");
    });
    const running = !!fx.machine;
    machineLight.current?.color.set(running ? (Math.sin(t * 12) > 0 ? ACCENT : "#ffd2c4") : "#c9c4ba");
    if (modelBlocks.current) modelBlocks.current.children.forEach((c, i) => { c.scale.y = running ? 1 + 0.35 * Math.sin(t * 6 + i) : 1; });
    if (dial.current) dial.current.rotation.y += fx.dial ? 0.12 : 0;
    const v = dir.agents.verifier;
    if (stamp.current) stamp.current.position.y = v?.anim === "stamp" ? 0.95 + Math.abs(Math.sin(t * 9)) * 0.35 : 1.3;
    printerLight.current?.color.set(dir.now < fx.printer ? ACCENT : "#c9c4ba");
    if (okStack.current) okStack.current.scale.y = 0.02 + fx.trays.accepted * 0.035;
    if (noStack.current) noStack.current.scale.y = 0.02 + (fx.trays.rejected + fx.trays.ask) * 0.035;
  });

  return (
    <group>
      {/* desks */}
      {Object.entries(DESKS).map(([id, p]) => <Desk key={id} at={p} long={id === "compiler"} />)}
      {/* chamber */}
      <Cyl x={TABLE.c[0]} z={TABLE.c[1]} r={TABLE.r} h={0.76} seg={48} />
      <Cyl x={TABLE.c[0]} z={TABLE.c[1]} r={1.0} h={0.02} y={0.76} color="#e8e4dc" />
      {["compiler", "apportionment", "engineer", "epidemiologist", "economist", "externalities", "skeptic", "writer", "planner"].map((id) => {
        const [x, z] = seat(id);
        return <Cyl key={id} x={x} z={z} r={0.32} h={0.45} color="#e8e4dc" seg={12} />;
      })}
      {/* lab */}
      <Block x={SPOTS.machine[0]} z={2.2} w={4.4} d={2} h={2.2} />
      <mesh position={[SPOTS.machine[0], 1.6, 3.22]}><planeGeometry args={[3, 0.5]} /><meshBasicMaterial ref={machineLight} color="#c9c4ba" /></mesh>
      {[6.5, 8.2, 9.9].map((z) => <Block key={z} x={0.9} z={z} w={1.1} d={1.3} h={2.0} color="#efece5" />)}
      <Block x={SPOTS.model[0]} z={SPOTS.model[1] - 1.2} w={3.2} d={2.2} h={0.8} />
      <group ref={modelBlocks} position={[SPOTS.model[0], 0.8, SPOTS.model[1] - 1.2]}>
        {model.map((b, i) => (
          <mesh key={i} position={[b.x, b.h / 2, b.z]} castShadow><boxGeometry args={[0.32, b.h, 0.28]} /><meshLambertMaterial color={PAPER} /></mesh>
        ))}
      </group>
      <Block x={12.9} z={4.6} w={0.8} d={1.4} h={1.05} />
      <mesh ref={dial} position={[12.9, 1.12, 4.6]}><cylinderGeometry args={[0.32, 0.32, 0.12, 6]} /><meshLambertMaterial color={ACCENT} /></mesh>
      {/* pantry */}
      <Block x={1.1} z={16.4} w={1.0} d={3.4} h={0.95} />
      <Block x={1.1} z={15.6} w={0.6} d={0.6} h={0.55} y={0.95} color="#2a2826" edges={false} />
      <Cyl x={12.7} z={22.4} r={0.35} h={1.3} color="#dde6ea" />
      <Block x={6.5} z={21.6} w={3.4} d={1.1} h={0.55} color="#e8e4dc" />
      <Plant x={12.6} z={15.2} />
      {/* verifier */}
      <group ref={stamp} position={[DESKS.verifier[0] + 0.5, 1.3, DESKS.verifier[1]]}>
        <mesh castShadow><cylinderGeometry args={[0.14, 0.18, 0.35, 12]} /><meshLambertMaterial color="#2a2826" /></mesh>
      </group>
      <Block x={SPOTS.trayOk[0]} z={SPOTS.trayOk[1]} w={1.1} d={0.8} h={0.8} />
      <Block x={SPOTS.trayNo[0]} z={SPOTS.trayNo[1]} w={1.1} d={0.8} h={0.8} />
      <mesh ref={okStack} position={[SPOTS.trayOk[0], 0.8, SPOTS.trayOk[1]]} scale={[1, 0.02, 1]}><boxGeometry args={[0.8, 1, 0.55]} /><meshLambertMaterial color={PAPER} /></mesh>
      <mesh ref={noStack} position={[SPOTS.trayNo[0], 0.8, SPOTS.trayNo[1]]} scale={[1, 0.02, 1]}><boxGeometry args={[0.8, 1, 0.55]} /><meshLambertMaterial color="#ffd8cc" /></mesh>
      <Block x={SPOTS.inbox[0] + 0.9} z={SPOTS.inbox[1]} w={0.9} d={0.7} h={0.9} />
      {/* records */}
      {CABINETS.map(([x, z], i) => (
        <group key={i}>
          <Block x={x} z={z} w={1.0} d={1.6} h={1.9} />
          <group position={[x - 0.5, 1.25, z]}>
            <mesh ref={(el) => { drawers.current[i] = el; }} position={[-0.05, 0, 0]} castShadow>
              <boxGeometry args={[0.1, 0.32, 1.2]} />
              <meshLambertMaterial color="#e8e4dc" />
            </mesh>
          </group>
        </group>
      ))}
      {/* planner + printer */}
      <Block x={SPOTS.printer[0] + 0.9} z={SPOTS.printer[1]} w={0.9} d={1.0} h={1.0} />
      <mesh position={[SPOTS.printer[0] + 0.9, 1.02, SPOTS.printer[1]]} rotation-x={-Math.PI / 2}><planeGeometry args={[0.6, 0.6]} /><meshBasicMaterial ref={printerLight} color="#c9c4ba" /></mesh>
      {/* lobby */}
      {[[10, 30.4], [28, 30.4], [33, 26]].map(([x, z]) => <Plant key={`${x}${z}`} x={x} z={z} />)}
      <Block x={27} z={30.6} w={3.6} d={0.9} h={0.45} color="#e8e4dc" />
      <Block x={3} z={26.6} w={3.4} d={0.12} h={1.3} />
    </group>
  );
}

// --------------------------------------------------------------------------- people

const legGeo = new THREE.BoxGeometry(0.16, 0.72, 0.18);
const armGeo = new THREE.BoxGeometry(0.12, 0.62, 0.14);
const torsoGeo = new THREE.BoxGeometry(0.52, 0.72, 0.3);
const headGeo = new THREE.SphereGeometry(0.2, 16, 12);
const paperGeo = new THREE.BoxGeometry(0.34, 0.02, 0.26);
const torsoEdges = new THREE.EdgesGeometry(torsoGeo);

function Person({ dir, id, selected, onSelect }: { dir: Director; id: string; selected: boolean; onSelect: (id: string) => void }) {
  const g = useRef<THREE.Group>(null!);
  const body = useRef<THREE.Group>(null!);
  const legs = useRef<(THREE.Mesh | null)[]>([]);
  const arms = useRef<(THREE.Mesh | null)[]>([]);
  const torsoMat = useRef<THREE.MeshLambertMaterial>(null!);
  const paper = useRef<THREE.Mesh>(null!);
  const isPlanner = id === "planner";
  const base = isPlanner ? "#3a3835" : id === "skeptic" ? "#9a958c" : "#d9d4ca";

  useFrame(({ clock }) => {
    const a = dir.agents[id];
    if (!a || !g.current) return;
    const t = clock.elapsedTime + a.phase;
    g.current.position.set(a.pos[0], 0, a.pos[1]);
    const dh = a.heading - g.current.rotation.y;
    g.current.rotation.y += Math.atan2(Math.sin(dh), Math.cos(dh)) * 0.25;
    const walking = a.anim === "walk" || a.anim === "carry";
    const swing = walking ? Math.sin(t * 9) * 0.55 : 0;
    legs.current[0] && (legs.current[0].rotation.x = swing);
    legs.current[1] && (legs.current[1].rotation.x = -swing);
    const typing = a.anim === "type" || a.anim === "dial" || a.anim === "drawer" || a.anim === "stamp" || a.anim === "print";
    const armA = walking ? -swing * 0.8 : typing ? -1.1 + Math.sin(t * 14) * 0.15 : a.anim === "talk" ? -0.4 + Math.sin(t * 3) * 0.35 : a.anim === "coffee" ? -1.6 : a.anim === "carry" ? -1.3 : 0;
    const armB = walking ? swing * 0.8 : typing ? -1.1 + Math.cos(t * 14) * 0.15 : a.anim === "carry" ? -1.3 : 0;
    arms.current[0] && (arms.current[0].rotation.x = armA);
    arms.current[1] && (arms.current[1].rotation.x = armB);
    const sitting = a.anim === "sit" || (a.anim === "talk" && !isPlanner && Math.hypot(a.pos[0] - 25, a.pos[1] - 16.5) < 6);
    body.current.position.y = sitting ? -0.32 : walking ? Math.abs(Math.sin(t * 9)) * 0.05 : 0;
    const live = !!a.say || a.anim === "drawer" || a.anim === "stamp" || a.anim === "dial" || a.carrying || selected;
    torsoMat.current?.color.set(live ? ACCENT : base);
    if (paper.current) paper.current.visible = a.carrying;
  });

  return (
    <group ref={g} onPointerDown={(e) => { e.stopPropagation(); onSelect(id); }}>
      <group ref={body}>
        {[-0.12, 0.12].map((x, i) => <mesh key={i} ref={(el) => { legs.current[i] = el; }} geometry={legGeo} position={[x, 0.36, 0]} castShadow><meshLambertMaterial color={isPlanner ? "#2a2826" : "#4a4743"} /></mesh>)}
        <group position={[0, 1.08, 0]}>
          <mesh geometry={torsoGeo} castShadow><meshLambertMaterial ref={torsoMat} color={base} /></mesh>
          <lineSegments geometry={torsoEdges} material={inkLine} />
        </group>
        {[-0.34, 0.34].map((x, i) => (
          <group key={i} position={[x, 1.4, 0]}>
            <mesh ref={(el) => { arms.current[i] = el; }} geometry={armGeo} position={[0, -0.28, 0]} castShadow><meshLambertMaterial color={base} /></mesh>
          </group>
        ))}
        <mesh geometry={headGeo} position={[0, 1.66, 0]} castShadow><meshLambertMaterial color="#efe6da" /></mesh>
        <mesh ref={paper} geometry={paperGeo} position={[0, 1.15, 0.36]} visible={false}><meshLambertMaterial color={PAPER} /></mesh>
      </group>
      {/* hit area */}
      <mesh position={[0, 1, 0]} visible={false}><cylinderGeometry args={[0.45, 0.45, 2, 8]} /></mesh>
    </group>
  );
}

// --------------------------------------------------------------------------- screen

function Screen({ dir }: { dir: Director }) {
  const canvas = useMemo(() => { const c = document.createElement("canvas"); c.width = 1024; c.height = 440; return c; }, []);
  const tex = useMemo(() => { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }, [canvas]);
  const last = useRef("");
  useFrame(() => {
    const s = dir.fx.screen;
    const key = JSON.stringify(s);
    if (key === last.current) return;
    last.current = key;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#fbfaf7"; g.fillRect(0, 0, 1024, 440);
    g.strokeStyle = INK; g.lineWidth = 6; g.strokeRect(3, 3, 1018, 434);
    g.fillStyle = "#6d6a64"; g.font = "600 26px 'Geist Mono', monospace"; g.fillText("CITY AIR COUNCIL · IN SESSION", 40, 64);
    g.fillStyle = INK; g.font = "700 44px Archivo, Geist, sans-serif";
    wrap(g, s.title, 40, 128, 940, 52, 2);
    const stages = ["scope", "simulate", "challenge", "verify", "decide"];
    stages.forEach((st, i) => {
      const x = 40 + i * 190, y = 270;
      const v = s.stages[st];
      g.fillStyle = v === "done" ? INK : v === "running" ? ACCENT : "#d8d4cb";
      g.beginPath(); g.arc(x + 14, y, 12, 0, Math.PI * 2); g.fill();
      g.fillStyle = v ? INK : "#9b978f"; g.font = "500 26px 'Geist Mono', monospace"; g.fillText(st.toUpperCase(), x + 36, y + 9);
    });
    if (s.range) { g.fillStyle = INK; g.font = "700 54px 'Geist Mono', monospace"; g.fillText(s.range, 40, 380); }
    g.fillStyle = "#6d6a64"; g.font = "500 26px 'Geist Mono', monospace";
    g.fillText(`${s.round ? `ROUND ${s.round}` : "AWAITING POLICY"}${s.confidence ? ` · CONFIDENCE ${s.confidence.toUpperCase()}` : ""}`, 560, 380);
    tex.needsUpdate = true;
  });
  return (
    <group position={[SPOTS.screen[0], 2.0, SPOTS.screen[1]]}>
      <Block x={0} z={-0.08} w={7.4} d={0.1} h={3.3} y={-1.65} />
      <mesh position={[0, 0, 0.01]}><planeGeometry args={[7, 3]} /><meshBasicMaterial map={tex} toneMapped={false} /></mesh>
    </group>
  );
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number, lines: number) {
  const words = text.split(" ");
  let line = "", n = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > max && line) {
      g.fillText(line, x, y + n * lh);
      line = w;
      if (++n >= lines) return;
    } else line = test;
  }
  g.fillText(line, x, y + n * lh);
}

// --------------------------------------------------------------------------- scene

export function CouncilScene({ dir, ids, selected, onSelect, speed, paused, anchors }: { dir: Director; ids: string[]; selected: string | null; onSelect: (id: string | null) => void; speed: number; paused: boolean; anchors: React.RefObject<Map<string, THREE.Vector3>> }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    cam.zoom = Math.min(size.width / (BUILDING.w * 1.55), size.height / (BUILDING.d * 1.35));
    cam.updateProjectionMatrix();
  }, [camera, size]);

  useFrame((_, dt) => {
    if (!paused) dir.step(Math.min(dt, 0.05) * 1000 * speed, 1);
    const m = anchors.current;
    if (!m) return;
    for (const id of ids) {
      const a = dir.agents[id];
      if (a) m.set(`agent:${id}`, new THREE.Vector3(a.pos[0], 2.35, a.pos[1]));
    }
    if (dir.fx.drawer) {
      const [x, z] = CABINETS[dir.fx.drawer.index];
      m.set("drawer", new THREE.Vector3(x - 1.2, 2.3, z));
    } else m.delete("drawer");
    if (dir.fx.stamp) m.set("stamp", new THREE.Vector3(DESKS.verifier[0] + 0.5, 2.6, DESKS.verifier[1]));
    else m.delete("stamp");
    if (dir.fx.dial) m.set("dial", new THREE.Vector3(12.9, 2.1, 4.6));
    else m.delete("dial");
    for (const r of ROOMS) m.set(`room:${r.id}`, new THREE.Vector3((r.x0 + r.x1) / 2, 0.1, r.z1 - 0.9));
  });

  return (
    <group onPointerMissed={() => onSelect(null)}>
      <Building />
      <Furniture dir={dir} />
      <Screen dir={dir} />
      {ids.map((id) => <Person key={id} dir={dir} id={id} selected={selected === id} onSelect={onSelect} />)}
    </group>
  );
}
