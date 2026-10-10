import { create } from "zustand";

export interface ProvenanceTarget {
  ref: string; // "L-009" | "sim:deltaLo" | "param:compliancePct" | "fp"
  runId?: string;
}

interface UiState {
  provenance: ProvenanceTarget | null;
  openProvenance: (t: ProvenanceTarget) => void;
  closeProvenance: () => void;
  palette: boolean;
  setPalette: (v: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  provenance: null,
  openProvenance: (provenance) => set({ provenance }),
  closeProvenance: () => set({ provenance: null }),
  palette: false,
  setPalette: (palette) => set({ palette }),
}));
