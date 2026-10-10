import type { RunEvent } from "@/lib/types";
import { CABINETS, DESKS, SPOTS, cabinetFor, route, seat, standAt, standAtCabinet, type V2 } from "./layout";

// The director turns engine events into things agents physically do, and keeps
// them busy with ordinary office routines in between. Pure TypeScript, stepped
// once per frame by the scene; React only reads snapshots for the HUD.

export type Anim = "idle" | "walk" | "type" | "talk" | "read" | "drawer" | "stamp" | "dial" | "carry" | "coffee" | "print" | "sit";

export type Step =
  | { kind: "move"; to: V2; carry?: boolean }
  | { kind: "act"; anim: Anim; ms: number; say?: string; label?: string; face?: V2; onStart?: () => void; onEnd?: () => void };

export interface Agent {
  id: string;
  name: string;
  pos: V2;
  heading: number;
  anim: Anim;
  path: V2[];
  queue: Step[];
  current: Step | null;
  until: number; // when the current act ends
  say: string | null;
  label: string | null;
  carrying: boolean;
  home: V2;
  busy: number; // ms of run work remaining, suppresses idle routines
  log: string[];
  phase: number; // per-agent animation phase
  inRoutine: boolean;
}

export interface Effects {
  drawer: { index: number; ref: string; until: number } | null;
  stamp: { status: string; until: number } | null;
  machine: { round: number; until: number } | null;
  dial: { label: string; until: number } | null;
  printer: number;
  trays: { accepted: number; rejected: number; ask: number };
  screen: { title: string; stages: Record<string, string>; range: string; round: number; confidence?: string };
}

export interface LogLine { t: number; agent: string; text: string; tone?: "accept" | "reject" | "ask" | "sim" | "param" }

const SPEED = 3.2; // metres per second, before time scaling

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export class Director {
  agents: Record<string, Agent> = {};
  fx: Effects = { drawer: null, stamp: null, machine: null, dial: null, printer: 0, trays: { accepted: 0, rejected: 0, ask: 0 }, screen: { title: "Council in recess", stages: {}, range: "", round: 0 } };
  log: LogLine[] = [];
  now = 0;
  private rand = rng(7);

  // Playback: the director owns the run clock and only advances it when the
  // bodies have caught up, so the story never runs ahead of the people in it.
  private events: RunEvent[] = [];
  private cursor = 0;
  runClock = 0;
  playing = false;
  private sayFn: (ev: RunEvent) => string | undefined = () => undefined;
  private onEvent: (ev: RunEvent) => void = () => {};

  play(events: RunEvent[], say: (ev: RunEvent) => string | undefined, onEvent: (ev: RunEvent) => void, title: string) {
    this.reset(title);
    this.events = events;
    this.cursor = 0;
    this.runClock = 0;
    this.sayFn = say;
    this.onEvent = onEvent;
    this.playing = true;
  }

  stop() { this.playing = false; }

  get progress() { return this.events.length ? this.cursor / this.events.length : 0; }

  private feed(dtMs: number) {
    if (!this.playing) return;
    const backlog = Math.max(...Object.values(this.agents).map((a) => a.queue.length + (a.path.length ? 1 : 0)));
    if (backlog <= 3) this.runClock += dtMs;
    while (this.cursor < this.events.length && this.events[this.cursor].t <= this.runClock) {
      const ev = this.events[this.cursor++];
      this.handle(ev, this.sayFn(ev));
      this.onEvent(ev);
      if (ev.type === "complete") this.playing = false;
    }
    if (this.cursor >= this.events.length) this.playing = false;
  }

  constructor(roster: { id: string; name: string }[]) {
    for (const [i, r] of roster.entries()) {
      const home = DESKS[r.id] ?? [25, 20];
      const p = standAt(home);
      this.agents[r.id] = { id: r.id, name: r.name, pos: [p[0], p[1]], heading: Math.PI, anim: "type", path: [], queue: [], current: null, until: 0, say: null, label: null, carrying: false, home, busy: 0, log: [], phase: i * 1.37, inRoutine: false };
    }
  }

  // ---------------------------------------------------------------- scheduling
  private push(id: string, ...steps: Step[]) {
    const a = this.agents[id];
    if (!a) return;
    if (a.inRoutine) {
      // Real work interrupts coffee: drop the routine where it stands.
      a.queue = [];
      a.path = [];
      a.current = null;
      a.say = null;
      a.label = null;
      a.inRoutine = false;
    }
    a.queue.push(...steps);
    a.busy = Math.max(a.busy, 4000);
  }
  private goto(_id: string, to: V2, carry = false): Step { return { kind: "move", to, carry }; }
  private note(agent: string, text: string, tone?: LogLine["tone"]) {
    this.log.push({ t: this.now, agent, text, tone });
    if (this.log.length > 200) this.log.shift();
    const a = this.agents[agent];
    if (a) { a.log.push(text); if (a.log.length > 12) a.log.shift(); }
  }

  reset(title: string) {
    this.fx.trays = { accepted: 0, rejected: 0, ask: 0 };
    this.fx.screen = { title, stages: {}, range: "", round: 0 };
    this.log = [];
    for (const a of Object.values(this.agents)) { a.queue = []; a.current = null; a.say = null; a.label = null; a.carrying = false; a.log = []; }
  }

  /** Map one engine event onto bodies and objects. `say` is pre-rendered text. */
  handle(ev: RunEvent, say?: string) {
    switch (ev.type) {
      case "stage": {
        this.fx.screen.stages[ev.stage] = ev.status === "start" ? "running" : "done";
        if (ev.stage === "scope" && ev.status === "start") {
          this.push("planner", this.goto("planner", SPOTS.reception), { kind: "act", anim: "talk", ms: 1400, say: "Here is the policy." }, this.goto("planner", standAt(DESKS.planner)));
          this.note("planner", "hands the policy to reception");
        }
        if (ev.stage === "challenge" && ev.status === "start") {
          for (const id of ["apportionment", "engineer", "epidemiologist", "economist", "externalities", "skeptic"]) this.push(id, this.goto(id, seat(id)), { kind: "act", anim: "sit", ms: 600 });
          this.note("verifier", "council convenes in the chamber");
        }
        break;
      }
      case "message": {
        const id = ev.agent;
        if (id === "simulator") {
          this.note("simulator", say ?? "results written", "sim");
          break;
        }
        if (id === "compiler") {
          this.push(id, this.goto(id, standAt(DESKS.compiler)), { kind: "act", anim: "talk", ms: 2400, say, face: SPOTS.reception });
        } else if (id === "writer") {
          this.push(id, this.goto(id, standAt(DESKS.writer)), { kind: "act", anim: "type", ms: 1600, say }, this.goto(id, SPOTS.printer), { kind: "act", anim: "print", ms: 1400, onStart: () => (this.fx.printer = this.now + 1400) }, this.goto(id, standAt(DESKS.planner)), { kind: "act", anim: "talk", ms: 1600, say: "The brief is on your desk." });
        } else if (id === "planner") {
          this.push(id, this.goto(id, seat("planner")), { kind: "act", anim: "talk", ms: 2600, say });
        } else {
          this.push(id, this.goto(id, seat(id)), { kind: "act", anim: "talk", ms: 2600, say, face: [25, 16.5] });
        }
        this.note(id, say ?? "speaks");
        break;
      }
      case "action": {
        const id = ev.agent;
        if (ev.tool === "ledger.lookup") {
          const i = cabinetFor(ev.target);
          this.push(id, this.goto(id, standAtCabinet(i)), {
            kind: "act", anim: "drawer", ms: 1300, label: ev.target, face: CABINETS[i],
            onStart: () => (this.fx.drawer = { index: i, ref: ev.target, until: this.now + 1300 }),
          });
          this.note(id, `opens ${ev.target}${ev.detail ? ` · ${ev.detail}` : ""}`);
        } else if (ev.tool === "claim.submit") {
          this.push(id, this.goto(id, SPOTS.inbox, true), { kind: "act", anim: "carry", ms: 500, label: ev.target, onEnd: () => (this.agents[id].carrying = false) });
          this.note(id, `files claim ${ev.target} with the verifier`);
        } else if (ev.tool === "verify") {
          this.push("verifier", this.goto("verifier", standAt(DESKS.verifier)), { kind: "act", anim: "read", ms: 900, label: ev.target });
          this.note("verifier", `checks ${ev.target}: tokens, rows, scope`);
        } else if (ev.tool === "param.propose") {
          this.push(id, this.goto(id, SPOTS.dial), {
            kind: "act", anim: "dial", ms: 1200, label: `${ev.target} ${ev.detail ?? ""}`, face: [12.8, 4.6],
            onStart: () => (this.fx.dial = { label: `${ev.target} ${ev.detail ?? ""}`, until: this.now + 1800 }),
          });
          this.note(id, `turns the dial: ${ev.target} ${ev.detail ?? ""}`, "param");
        } else if (ev.tool === "sim.run") {
          this.fx.machine = { round: Number(String(ev.target).replace(/\D/g, "")) || 1, until: this.now + 2200 };
          this.note("simulator", `runs ${ev.target}`, "sim");
        }
        break;
      }
      case "verdict": {
        const tone = ev.status === "accepted" ? "accept" : ev.status === "rejected" ? "reject" : "ask";
        this.push("verifier", { kind: "act", anim: "stamp", ms: 1000, label: ev.status.toUpperCase(), onStart: () => {
          this.fx.stamp = { status: ev.status, until: this.now + 1600 };
          if (ev.status === "accepted") this.fx.trays.accepted++;
          else if (ev.status === "rejected") this.fx.trays.rejected++;
          else this.fx.trays.ask++;
        } });
        this.note("verifier", `${ev.status === "ask" ? "[ASK]" : ev.status.toUpperCase()} ${ev.claimId} · ${ev.reason.replace(/\[\[[^\]]+\]\]/g, "").slice(0, 90)}`, tone);
        break;
      }
      case "sim":
        this.fx.screen.round = ev.round;
        this.fx.machine = { round: ev.round, until: this.now + 2400 };
        break;
      case "complete":
        this.fx.screen.stages.decide = "done";
        this.note("writer", "brief filed · council adjourns");
        for (const a of Object.values(this.agents)) a.busy = Math.min(a.busy, 2000);
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- per-frame
  step(dtMs: number, scale = 1) {
    this.now += dtMs;
    this.feed(dtMs);
    const dt = (dtMs / 1000) * scale;
    for (const a of Object.values(this.agents)) {
      a.busy = Math.max(0, a.busy - dtMs);
      // pick up the next step
      if (!a.current && a.path.length === 0) {
        const next = a.queue.shift();
        if (next) this.begin(a, next);
        else if (this.playing) this.waitAtPost(a);
        else if (a.busy === 0) this.routine(a);
      }
      // walk
      if (a.path.length) {
        const [tx, tz] = a.path[0];
        const dx = tx - a.pos[0], dz = tz - a.pos[1];
        const dist = Math.hypot(dx, dz);
        const hurry = 1 + Math.min(2, a.queue.length * 0.35); // catch up when a backlog builds
        const stepLen = SPEED * hurry * dt;
        a.anim = a.carrying ? "carry" : "walk";
        a.heading = Math.atan2(dx, dz);
        if (dist <= stepLen) {
          a.pos = [tx, tz];
          a.path.shift();
          if (!a.path.length && a.current?.kind === "move") a.current = null;
        } else {
          a.pos = [a.pos[0] + (dx / dist) * stepLen, a.pos[1] + (dz / dist) * stepLen];
        }
        continue;
      }
      // act
      if (a.current?.kind === "act" && this.now >= a.until) {
        a.current.onEnd?.();
        a.current = null;
        a.say = null;
        a.label = null;
        a.anim = "idle";
      }
    }
    if (this.fx.drawer && this.now > this.fx.drawer.until) this.fx.drawer = null;
    if (this.fx.stamp && this.now > this.fx.stamp.until) this.fx.stamp = null;
    if (this.fx.dial && this.now > this.fx.dial.until) this.fx.dial = null;
    if (this.fx.machine && this.now > this.fx.machine.until) this.fx.machine = null;
  }

  private begin(a: Agent, s: Step) {
    a.current = s;
    if (s.kind === "move") {
      a.carrying = !!s.carry;
      a.path = route(a.pos, s.to);
      if (!a.path.length) a.current = null;
      return;
    }
    a.anim = s.anim;
    a.say = s.say ?? null;
    a.label = s.label ?? null;
    a.until = this.now + s.ms;
    if (s.face) a.heading = Math.atan2(s.face[0] - a.pos[0], s.face[1] - a.pos[1]);
    s.onStart?.();
  }

  /** In session nobody wanders off: council members take their seat, staff stay at their desks. */
  private waitAtPost(a: Agent) {
    const inSession = ["apportionment", "engineer", "epidemiologist", "economist", "externalities", "skeptic"].includes(a.id) && this.fx.screen.stages.challenge;
    const post = inSession ? seat(a.id) : standAt(a.home);
    if (Math.hypot(post[0] - a.pos[0], post[1] - a.pos[1]) > 0.3) {
      a.queue.push(this.goto(a.id, post), { kind: "act", anim: inSession ? "sit" : "type", ms: 900, face: inSession ? [25, 16.5] : a.home });
    } else {
      this.begin(a, { kind: "act", anim: inSession ? "sit" : a.id === "verifier" ? "read" : "type", ms: 900, face: inSession ? [25, 16.5] : a.home });
    }
  }

  /** Ordinary office life when nothing is asked of an agent. */
  private routine(a: Agent) {
    a.inRoutine = true;
    if (a.id === "planner") return this.begin(a, { kind: "act", anim: "type", ms: 4000 });
    const r = this.rand();
    const desk = standAt(a.home);
    if (r < 0.55) {
      a.queue.push(this.goto(a.id, desk), { kind: "act", anim: a.id === "verifier" ? "read" : "type", ms: 3500 + this.rand() * 4000, face: a.home });
    } else if (r < 0.72) {
      a.queue.push(this.goto(a.id, SPOTS.coffee), { kind: "act", anim: "coffee", ms: 2200, face: [1.2, 16.2] }, this.goto(a.id, desk));
    } else if (r < 0.86) {
      const others = Object.values(this.agents).filter((o) => o.id !== a.id && o.id !== "planner");
      const buddy = others[Math.floor(this.rand() * others.length)];
      a.queue.push(this.goto(a.id, [SPOTS.cooler[0] - 0.8, SPOTS.cooler[1]]), { kind: "act", anim: "talk", ms: 2600, say: smallTalk(this.rand), face: SPOTS.cooler });
      if (buddy && !buddy.queue.length && !buddy.busy) buddy.queue.push(this.goto(buddy.id, [SPOTS.cooler[0] + 0.9, SPOTS.cooler[1] + 0.4]), { kind: "act", anim: "talk", ms: 2600, face: SPOTS.cooler });
    } else if (r < 0.94) {
      a.queue.push(this.goto(a.id, SPOTS.window), { kind: "act", anim: "idle", ms: 2400, face: [9, 0] });
    } else {
      const i = Math.floor(this.rand() * CABINETS.length);
      a.queue.push(this.goto(a.id, standAtCabinet(i)), { kind: "act", anim: "read", ms: 2000, face: CABINETS[i] });
    }
  }
}

const TALK = [
  "Haze is back over the Yamuna.",
  "Did the Anand Vihar feed update?",
  "Check the mixing height first.",
  "That study was city-wide, not zonal.",
  "Coffee. Then the ledger.",
  "Night counts at the border look thin.",
  "Stubble season again.",
];
function smallTalk(rand: () => number) {
  return TALK[Math.floor(rand() * TALK.length)];
}
