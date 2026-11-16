import { create } from "zustand";
import type {
  ActiveSample,
  ChopJobProgress,
  DigMode,
  ExportFormat,
  SampleCandidate,
  SearchFilters,
} from "../types/crate";

interface CrateState {
  samplesDir: string;
  savedCount: number;
  exportFormat: ExportFormat;
  filters: SearchFilters;
  isRolling: boolean;
  queryUsed: string;
  queryTag: string;
  candidates: SampleCandidate[];
  errorMsg: string | null;
  activeJob: ChopJobProgress | null;
  activeSample: ActiveSample | null;

  setStorageInfo: (dir: string, count: number) => void;
  setExportFormat: (fmt: ExportFormat) => void;
  setMode: (mode: DigMode) => void;
  updateFilter: <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => void;
  setRolling: (rolling: boolean) => void;
  setRollResult: (queryUsed: string, queryTag: string, candidates: SampleCandidate[]) => void;
  setError: (msg: string | null) => void;
  setActiveJob: (job: ChopJobProgress | null) => void;
  setActiveSample: (sample: ActiveSample | null) => void;
}

export const useCrateStore = create<CrateState>((set) => ({
  samplesDir: "",
  savedCount: 0,
  exportFormat: "wav",
  filters: {
    mode: "world_adventure",
    sampleType: "all",
    region: "all",
    decade: "all",
    duration: "any",
    genre: "all",
    cardCount: 3,
  },
  isRolling: false,
  queryUsed: "",
  queryTag: "",
  candidates: [],
  errorMsg: null,
  activeJob: null,
  activeSample: null,

  setStorageInfo: (samplesDir, savedCount) => set({ samplesDir, savedCount }),
  setExportFormat: (exportFormat) => set({ exportFormat }),
  setMode: (mode) =>
    set((state) => ({
      filters: { ...state.filters, mode },
    })),
  updateFilter: (key, value) =>
    set((state) => ({
      filters: { ...state.filters, [key]: value },
    })),
  setRolling: (isRolling) => set({ isRolling }),
  setRollResult: (queryUsed, queryTag, candidates) =>
    set({ queryUsed, queryTag, candidates, errorMsg: null }),
  setError: (errorMsg) => set({ errorMsg }),
  setActiveJob: (activeJob) => set({ activeJob }),
  setActiveSample: (activeSample) => set({ activeSample }),
}));