import { create } from "zustand";
import type { AgentId, Claim, ParamKey, RunEvent, StageId } from "@/lib/types";
import type { RunBundle } from "./runs";

interface PlaybackState {
  runId: string | null;
  elapsed: number;
  playing: boolean;
  speed: number;
  load: (runId: string, live: boolean, duration: number) => void;
  tick: (dt: number, duration: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  seek: (ms: number) => void;
}

export const usePlayback = create<PlaybackState>((set, get) => ({
  runId: null,
  elapsed: 0,
  playing: false,
  speed: 1,
  load: (runId, live, duration) => set({ runId, elapsed: live ? 0 : duration, playing: live }),
  tick: (dt, duration) => {
    const { playing, speed, elapsed } = get();
    if (!playing) return;
    const next = Math.min(duration, elapsed + dt * speed);
    set({ elapsed: next, playing: next < duration });
  },
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  seek: (ms) => set({ elapsed: ms }),
}));

export type StageStatus = "idle" | "running" | "done";

export interface DerivedRun {
  index: number;
  events: RunEvent[];
  stages: Record<StageId, StageStatus>;
  messages: Extract<RunEvent, { type: "message" }>[];
  claims: Record<string, Claim>;
  params: Partial<Record<ParamKey, number>>;
  simRound: number;
  activeAgent: AgentId | null;
  focus: [number, number] | null;
  lastVerdict: Extract<RunEvent, { type: "verdict" }> | null;
  complete: boolean;
}

export function eventIndex(events: RunEvent[], elapsed: number) {
  let i = 0;
  while (i < events.length && events[i].t <= elapsed) i++;
  return i;
}

export function derive(b: RunBundle, index: number): DerivedRun {
  const events = b.script.events.slice(0, index);
  const stages: Record<StageId, StageStatus> = { scope: "idle", simulate: "idle", challenge: "idle", verify: "idle", decide: "idle" };
  const messages: DerivedRun["messages"] = [];
  const claims: Record<string, Claim> = {};
  const params: DerivedRun["params"] = {};
  let simRound = 0;
  let activeAgent: AgentId | null = null;
  let focus: [number, number] | null = null;
  let lastVerdict: DerivedRun["lastVerdict"] = null;
  let complete = false;

  for (const e of events) {
    if (e.type === "stage") stages[e.stage] = e.status === "start" ? "running" : "done";
    else if (e.type === "message") {
      messages.push(e);
      activeAgent = e.agent;
      if (e.focus) focus = e.focus;
      if (e.claimId) claims[e.claimId] = { ...b.script.claims[e.claimId], status: "pending", reason: undefined };
    } else if (e.type === "verdict") {
      claims[e.claimId] = { ...b.script.claims[e.claimId], status: e.status, reason: e.reason, ledgerRef: e.ledgerRef };
      activeAgent = "verifier";
      lastVerdict = e;
    } else if (e.type === "param") params[e.key] = e.to;
    else if (e.type === "sim") { simRound = e.round; activeAgent = "simulator"; }
    else if (e.type === "complete") { complete = true; activeAgent = null; }
  }
  return { index, events, stages, messages, claims, params, simRound, activeAgent, focus, lastVerdict, complete };
}
