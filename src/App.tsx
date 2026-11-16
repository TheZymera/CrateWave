import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { TopBar, type WindowSizePreset } from "./components/TopBar";
import { CenterStage } from "./components/CenterStage";
import { ControlDeck } from "./components/ControlDeck";
import { SettingsModal } from "./components/SettingsModal";
import { useCrateStore } from "./store/useCrateStore";
import type {
  ActiveSample,
  ChopJobProgress,
  SampleCandidate,
  StorageInfo,
} from "./types/crate";
import "./App.css";

interface RollResponse {
  queryUsed: string;
  queryTag: string;
  candidates: SampleCandidate[];
}

const WINDOW_DIMS: Record<WindowSizePreset, [number, number]> = {
  small: [1470, 770],
  medium: [1650, 930],
  big: [2000, 1200],
};

function App() {
  const [windowPreset, setWindowPreset] = useState<WindowSizePreset>("medium");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadingCardId, setLoadingCardId] = useState<string | null>(null);

  const {
    samplesDir,
    savedCount,
    exportFormat,
    filters,
    isRolling,
    queryUsed,
    queryTag,
    candidates,
    errorMsg,
    activeJob,
    activeSample,
    setStorageInfo,
    setExportFormat,
    setRolling,
    setRollResult,
    setError,
    setActiveJob,
    setActiveSample,
  } = useCrateStore();

  useEffect(() => {
    const preventContextMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", preventContextMenu);
    return () => window.removeEventListener("contextmenu", preventContextMenu);
  }, []);

  const refreshStorageCount = () => {
    invoke<StorageInfo>("init_storage")
      .then((info) => setStorageInfo(info.samplesDir, info.seenCount))
      .catch((err) => setError(String(err)));
  };

  useEffect(() => {
    refreshStorageCount();
  }, []);

  useEffect(() => {
    const unlistenPromise = listen<ChopJobProgress>("chop-progress", (event) => {
      setActiveJob(event.payload);
    });
    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [setActiveJob]);

  const handleChangeWindowPreset = async (preset: WindowSizePreset) => {
    setWindowPreset(preset);
    const [w, h] = WINDOW_DIMS[preset];
    try {
      const win = getCurrentWindow();
      await win.setSize(new LogicalSize(w, h));
      await win.center();
    } catch (err) {
      console.error("Failed to resize window:", err);
    }
  };

  const handleRoll = async () => {
    setRolling(true);
    setError(null);
    setActiveSample(null);
    try {
      const res = await invoke<RollResponse>("roll_crate", { filters });
      setRollResult(res.queryUsed, res.queryTag, res.candidates);
    } catch (err) {
      setError(String(err));
    } finally {
      setRolling(false);
    }
  };

  const handleLoadAndChop = async (candidate: SampleCandidate) => {
    setLoadingCardId(candidate.id);
    setError(null);
    setActiveJob({
      jobId: candidate.id,
      stage: "downloading",
      percent: 2,
      message: "Starting download...",
    });

    try {
      const sample = await invoke<ActiveSample>("load_and_chop_sample", {
        candidate,
        mode: filters.mode,
        format: exportFormat,
      });
      setActiveSample(sample);
      refreshStorageCount();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingCardId(null);
      setActiveJob(null);
    }
  };

  const handleUpdateSample = (updated: ActiveSample) => {
    setActiveSample(updated);
    refreshStorageCount();
  };

  const handleOpenSamples = async () => {
  await invoke("open_samples_folder").catch((err) => setError(String(err)));
};

  const handleOpenQueriesFile = async () => {
    try {
      const path = await invoke<string>("get_queries_file_path");
      await revealItemInDir(path);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[#161922] text-[#E6E8F0]">
      <TopBar
        queryUsed={queryUsed}
        queryTag={queryTag}
        exportFormat={exportFormat}
        savedCount={savedCount}
        onToggleFormat={setExportFormat}
        onOpenSamplesFolder={handleOpenSamples}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <CenterStage
        candidates={candidates}
        isRolling={isRolling}
        errorMsg={errorMsg}
        activeJob={activeJob}
        activeSample={activeSample}
        loadingCardId={loadingCardId}
        mode={filters.mode}
        exportFormat={exportFormat}
        onLoadAndChop={handleLoadAndChop}
        onUpdateSample={handleUpdateSample}
        onClearActiveSample={() => setActiveSample(null)}
      />

      <ControlDeck onRoll={handleRoll} />

      <SettingsModal
        isOpen={settingsOpen}
        windowPreset={windowPreset}
        onChangeWindowPreset={handleChangeWindowPreset}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

export default App;