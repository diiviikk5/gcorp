import { finalSim, type RunBundle } from "@/store/runs";

export interface Recommendation {
  verdict: "proceed" | "pilot" | "weak" | "reject";
  label: string;
  line: string;
}

// Deterministic rule over simulator output, not an agent opinion.
export function recommend(b: RunBundle): Recommendation {
  const s = finalSim(b).summary;
  const blocked = b.record.scenario.warnings.some((w) => w.level === "block");
  if (blocked || s.pctHi < 0.5) return { verdict: "reject", label: "Not recommended", line: "The policy targets almost none of the emissions it is meant to cut." };
  if (s.pctHi < 3) return { verdict: "weak", label: "Low impact", line: "A small, uncertain gain. Compare alternatives before committing." };
  if (s.coverage !== "good" || s.pctLo < 2) return { verdict: "pilot", label: "Pilot with monitoring", line: "Direction is clear, size is uncertain. Run a time-boxed pilot and measure." };
  return { verdict: "proceed", label: "Worth doing", line: "A meaningful reduction even at the conservative end of the range." };
}
