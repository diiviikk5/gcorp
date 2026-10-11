import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { mulberry32 } from "@/sim/rng";

// Crop-residue smoke from Punjab and Haryana, carried in on the north-westerly
// winds of October–November. Density follows the regional share of PM2.5 the
// council is working with ([[L-032]] by month, raised by the Externalities analyst
// on peak days). It is the part of the air no Delhi policy can touch.
export function StubbleSmoke({ size, share }: { size: number; share: number }) {
  const count = Math.round(Math.min(1, Math.max(0, (share - 5) / 40)) * 140);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const puffs = useMemo(() => {
    const r = mulberry32(2024);
    return Array.from({ length: 140 }, () => ({
      t: r(),                       // progress along the drift
      lane: (r() - 0.5) * size * 1.1, // spread across the wind
      y: 1.2 + r() * 4.2,
      s: 1.4 + r() * 2.6,
      speed: 0.018 + r() * 0.02,
      wob: r() * Math.PI * 2,
    }));
  }, [size]);
  const geo = useMemo(() => new THREE.IcosahedronGeometry(1, 1), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#a89880", transparent: true, opacity: 0.16, depthWrite: false, roughness: 1 }), []);
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const sc = useMemo(() => new THREE.Vector3(), []);
  // Wind from the north-west: enters at (-x, -z), drifts toward (+x, +z).
  const dir = useMemo(() => new THREE.Vector2(1, 1).normalize(), []);
  const perp = useMemo(() => new THREE.Vector2(-1, 1).normalize(), []);

  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    const span = size * 1.6;
    for (let i = 0; i < count; i++) {
      const p = puffs[i];
      p.t = (p.t + p.speed * Math.min(dt, 0.05)) % 1;
      const along = -span / 2 - size * 0.25 + p.t * span;
      const fade = Math.sin(Math.PI * p.t); // grow in, thin out
      v.set(dir.x * along + perp.x * p.lane, p.y + Math.sin(p.t * 6 + p.wob) * 0.4, dir.y * along + perp.y * p.lane);
      const s = p.s * (0.6 + 0.8 * p.t) * (0.35 + 0.65 * fade);
      sc.set(s * 1.4, s * 0.6, s);
      m4.compose(v, q, sc);
      m.setMatrixAt(i, m4);
    }
    m.count = count;
    m.instanceMatrix.needsUpdate = true;
  });

  if (count === 0) return null;
  return <instancedMesh ref={mesh} args={[geo, mat, 140]} renderOrder={30} frustumCulled={false} />;
}
