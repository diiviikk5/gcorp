// The Council House: a single-storey civic building, cut away like an
// architect's model. Units are metres; x runs east, z runs south.

export type V2 = [number, number];

export interface Room { id: string; name: string; x0: number; z0: number; x1: number; z1: number; tint: string }

export const BUILDING = { w: 48, d: 32 };

export const ROOMS: Room[] = [
  { id: "lab", name: "Simulation lab", x0: 0, z0: 0, x1: 14, z1: 14, tint: "#efece5" },
  { id: "analysts", name: "Analysts", x0: 14, z0: 0, x1: 26, z1: 9, tint: "#f3f1ec" },
  { id: "planner", name: "Planner's office", x0: 26, z0: 0, x1: 36, z1: 9, tint: "#f1eee8" },
  { id: "verifier", name: "Verifier", x0: 36, z0: 0, x1: 48, z1: 12, tint: "#efece5" },
  { id: "chamber", name: "Council chamber", x0: 14, z0: 9, x1: 36, z1: 24, tint: "#f6f4f0" },
  { id: "records", name: "Records · ledger", x0: 36, z0: 12, x1: 48, z1: 32, tint: "#eeebe4" },
  { id: "pantry", name: "Pantry", x0: 0, z0: 14, x1: 14, z1: 24, tint: "#f1eee8" },
  { id: "lobby", name: "Lobby", x0: 0, z0: 24, x1: 36, z1: 32, tint: "#f3f1ec" },
];

// Door gaps in the partitions, each joining two rooms.
export const DOORS: { a: string; b: string; at: V2; axis: "x" | "z" }[] = [
  { a: "lab", b: "chamber", at: [14, 11], axis: "x" },
  { a: "lab", b: "pantry", at: [5, 14], axis: "z" },
  { a: "pantry", b: "lobby", at: [7, 24], axis: "z" },
  { a: "pantry", b: "chamber", at: [14, 19], axis: "x" },
  { a: "chamber", b: "lobby", at: [25.5, 24], axis: "z" },
  { a: "chamber", b: "analysts", at: [20, 9], axis: "z" },
  { a: "chamber", b: "planner", at: [31, 9], axis: "z" },
  { a: "chamber", b: "verifier", at: [36, 10.5], axis: "x" },
  { a: "chamber", b: "records", at: [36, 19], axis: "x" },
  { a: "records", b: "verifier", at: [42, 12], axis: "z" },
  { a: "records", b: "lobby", at: [36, 28], axis: "x" },
];
export const DOOR_W = 2.2;

export function roomAt([x, z]: V2): Room {
  return ROOMS.find((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) ?? ROOMS[ROOMS.length - 1];
}

/** Route between two points: straight inside a room, through doors between rooms (BFS over the door graph). */
export function route(from: V2, to: V2): V2[] {
  const a = roomAt(from).id, b = roomAt(to).id;
  if (a === b) return [to];
  const prev = new Map<string, { room: string; door: (typeof DOORS)[number] }>();
  const seen = new Set([a]);
  const q = [a];
  while (q.length) {
    const r = q.shift()!;
    if (r === b) break;
    for (const d of DOORS) {
      const n = d.a === r ? d.b : d.b === r ? d.a : null;
      if (n && !seen.has(n)) { seen.add(n); prev.set(n, { room: r, door: d }); q.push(n); }
    }
  }
  const doors: V2[] = [];
  let cur = b;
  while (cur !== a && prev.has(cur)) {
    const p = prev.get(cur)!;
    // step through the door: approach on one side, exit on the other
    const [dx, dz] = p.door.at;
    const off = 0.9;
    const fromRoom = ROOMS.find((r) => r.id === p.room)!;
    const inside = p.door.axis === "x" ? (fromRoom.x0 < dx ? -off : off) : (fromRoom.z0 < dz ? -off : off);
    const approach: V2 = p.door.axis === "x" ? [dx + inside, dz] : [dx, dz + inside];
    const exit: V2 = p.door.axis === "x" ? [dx - inside, dz] : [dx, dz - inside];
    doors.unshift(approach, exit);
    cur = p.room;
  }
  return [...doors, to];
}

// --- furniture and spots --------------------------------------------------------

export const TABLE = { c: [25, 16.5] as V2, r: 3.4 };
export const SEAT_ORDER = ["compiler", "apportionment", "engineer", "epidemiologist", "economist", "externalities", "skeptic", "writer", "planner"];
export function seat(agent: string): V2 {
  const i = Math.max(0, SEAT_ORDER.indexOf(agent));
  const t = (i / SEAT_ORDER.length) * Math.PI * 2 - Math.PI / 2;
  return [TABLE.c[0] + Math.cos(t) * (TABLE.r + 1.1), TABLE.c[1] + Math.sin(t) * (TABLE.r + 1.1)];
}

export const DESKS: Record<string, V2> = {
  compiler: [20, 28.4],
  engineer: [16.8, 3],
  epidemiologist: [20, 3],
  economist: [23.2, 3],
  apportionment: [16.8, 6.4],
  externalities: [23.2, 6.4],
  writer: [28.4, 6.2],
  planner: [31, 3.4],
  verifier: [42, 4.4],
  skeptic: [3, 28.4], // independent review, physically apart
};
/** Where a person stands to work at their desk (desks face south). */
export const standAt = (p: V2): V2 => [p[0], p[1] + 1.1];

export const SPOTS = {
  coffee: [2.2, 16.2] as V2,
  cooler: [12, 22.4] as V2,
  sofa: [6.5, 20.5] as V2,
  window: [9, 1.6] as V2,
  printer: [34.4, 7.4] as V2,
  dial: [11.6, 4.6] as V2,
  machine: [4.8, 4] as V2,
  model: [8, 9.5] as V2,
  inbox: [44.6, 9.6] as V2,
  trayOk: [45.6, 3] as V2,
  trayNo: [45.6, 6] as V2,
  screen: [25, 9.3] as V2,
  reception: [20, 30.2] as V2,
  door: [18, 31.6] as V2,
};

// Ledger cabinets in the records room: 3 rows × 6.
export const CABINETS: V2[] = Array.from({ length: 18 }, (_, i) => {
  const row = Math.floor(i / 6), col = i % 6;
  return [38.6 + row * 3.4, 14.6 + col * 2.8];
});
export function cabinetFor(ref: string): number {
  let h = 0;
  for (const ch of ref) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % CABINETS.length;
}
export const standAtCabinet = (i: number): V2 => [CABINETS[i][0] - 1.0, CABINETS[i][1]];

export const ROLE_PATH: { id: string; label: string }[] = [
  { id: "compiler", label: "Compiler" },
  { id: "apportionment", label: "Source analyst" },
  { id: "engineer", label: "Engineer" },
  { id: "epidemiologist", label: "Epidemiologist" },
  { id: "economist", label: "Economist" },
  { id: "externalities", label: "Externalities" },
  { id: "skeptic", label: "Skeptic" },
  { id: "verifier", label: "Verifier" },
  { id: "writer", label: "Brief writer" },
  { id: "planner", label: "Planner" },
];
