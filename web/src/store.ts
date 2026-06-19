import { create } from "zustand";

export type View = "dashboard" | "new" | "monitor" | "reports" | "settings" | "terminal";

type UIState = {
  view: View;
  activeAnalysisId: string | null;
  activeReportId: string | null;
  setView: (view: View) => void;
  setActiveAnalysisId: (id: string | null) => void;
  setActiveReportId: (id: string | null) => void;
};

export const useUIStore = create<UIState>((set) => ({
  view: "dashboard",
  activeAnalysisId: null,
  activeReportId: null,
  setView: (view) => set({ view }),
  setActiveAnalysisId: (id) => set({ activeAnalysisId: id }),
  setActiveReportId: (id) => set({ activeReportId: id })
}));
