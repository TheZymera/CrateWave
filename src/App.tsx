import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { TopBar, type WindowSizePreset } from "./components/TopBar";
import { TurntableStage } from "./components/TurntableStage";
import { useCrateStore } from "./store/useCrateStore";
import { TurntableAudioDeck } from "./utils/tapeAudioFx";

import type {
  ActiveSample,
  SampleCandidate,
  StorageInfo,
} from "./types/crate";
import "./App.css";

interface RollResponse {
  queryUsed: string;
  queryTag: string;
  candidates: SampleCandidate[];
}

interface ReadyDeckItem {
  candidate: SampleCandidate;
  sample: ActiveSample;
}

type ReadyItemPromise = Promise<ReadyDeckItem>;

const TARGET_READY_STACK = 1;

const WINDOW_DIMS: Record<WindowSizePreset, [number, number]> = {
  small: [1100, 620],
  medium: [1470, 770],
  big: [1650, 930],
};

function App() {
  const [windowPreset, setWindowPreset] = useState<WindowSizePreset>("medium");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [trimModalOpen, setTrimModalOpen] = useState(false);

  const [currentCandidate, setCurrentCandidate] = useState<SampleCandidate | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingTrack, setIsLoadingTrack] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [vuLevel, setVuLevel] = useState(0);
  const [masterVolume, setMasterVolume] = useState(0.85);

  const candidatePoolRef = useRef<SampleCandidate[]>([]);
  const readyQueueRef = useRef<ReadyItemPromise[]>([]);
  const isFetchingPoolRef = useRef<Promise<void> | null>(null);
  const isRerollingRef = useRef(false);
  const generationIdRef = useRef(0);
  const lastFilterSigRef = useRef("");
  const extendedIdsRef = useRef<Set<string>>(new Set());

  const deckRef = useRef<TurntableAudioDeck | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const {
    savedCount,
    exportFormat,
    filters,
    queryUsed,
    queryTag,
    errorMsg,
    activeSample,
    setStorageInfo,
    setExportFormat,
    setRollResult,
    setError,
    setActiveSample,
  } = useCrateStore();

  const filterSig = JSON.stringify({
    mode: filters.mode,
    sampleType: filters.sampleType,
    region: filters.region,
    decade: filters.decade,
    duration: filters.duration,
    genre: filters.genre,
  });

  useEffect(() => {
    const preventContextMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", preventContextMenu);
    return () => window.removeEventListener("contextmenu", preventContextMenu);
  }, []);

  const syncSamplesCountFromDisk = () => {
  invoke<StorageInfo>("init_storage")
    .then((info) => setStorageInfo(info.samplesDir, info.seenCount))
    .catch((err) => setError(String(err)));
  };

  useEffect(() => {
    syncSamplesCountFromDisk();
    window.addEventListener("focus", syncSamplesCountFromDisk);
    const interval = window.setInterval(syncSamplesCountFromDisk, 3000);
    return () => {
      window.removeEventListener("focus", syncSamplesCountFromDisk);
      window.clearInterval(interval);
    };
  }, []);

  // Initialize Pure Web Audio Deck
  useEffect(() => {
    const deck = new TurntableAudioDeck((playing) => {
      setIsPlaying(playing);
    });
    deck.setVolume(masterVolume);
    deckRef.current = deck;

    return () => {
      deck.destroy();
      deckRef.current = null;
    };
  }, []);

  useEffect(() => {
    deckRef.current?.setVolume(masterVolume);
  }, [masterVolume]);

  // 60fps Master VU Needle & Auto-Extend Loop
  useEffect(() => {
    const tick = () => {
      const deck = deckRef.current;
      if (deck && deck.isPlaying()) {
        setVuLevel(deck.getVuLevel());

        // Check if 45s initial capture needs seamless full-track extension
        const dur = deck.getDuration();
        const cur = deck.getCurrentTime();
        if (
          currentCandidate &&
          dur > 10 &&
          currentCandidate.durationSec > dur + 8 &&
          cur >= dur - 12 &&
          !extendedIdsRef.current.has(currentCandidate.id)
        ) {
          extendedIdsRef.current.add(currentCandidate.id);
          invoke<ActiveSample>("extend_sample_audio", {
            candidate: currentCandidate,
            mode: filters.mode,
            format: exportFormat,
          })
            .then((extended) => {
              setActiveSample(extended);
              return deck.swapExtendedBuffer(
                extended.streamUrl,
                extended.masterWavPath
              );
            })
            .catch(() => {});
        }
      } else {
        setVuLevel(0);
      }
      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [isPlaying, currentCandidate, filters.mode, exportFormat]);

  const ensureCandidatePool = async (genId: number) => {
    if (candidatePoolRef.current.length > 0) return;

    if (!isFetchingPoolRef.current) {
      isFetchingPoolRef.current = (async () => {
        try {
          const res = await invoke<RollResponse>("roll_crate", {
            filters: { ...filters, cardCount: 1 },
          });
          if (genId === generationIdRef.current) {
            setRollResult(res.queryUsed, res.queryTag, res.candidates);
            candidatePoolRef.current.push(...res.candidates);
          }
        } finally {
          isFetchingPoolRef.current = null;
        }
      })();
    }

    await isFetchingPoolRef.current;
  };

  const createReadySlotPromise = async (genId: number): Promise<ReadyDeckItem> => {
    let attempts = 0;
    let lastErr: unknown = new Error("No playable tracks found.");

    while (genId === generationIdRef.current && attempts < 3) {
      attempts += 1;
      await ensureCandidatePool(genId);
      if (genId !== generationIdRef.current) {
        throw new Error("Filter changed");
      }

      const cand = candidatePoolRef.current.shift();
      if (!cand) {
        throw new Error("No tracks found for this filter combination.");
      }

      try {
        const sample = await invoke<ActiveSample>("load_and_chop_sample", {
          candidate: cand,
          mode: filters.mode,
          format: exportFormat,
        });
        if (genId !== generationIdRef.current) {
          throw new Error("Filter changed");
        }
        return { candidate: cand, sample };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  };

  const topUpReadyQueue = (genId: number) => {
    while (
      genId === generationIdRef.current &&
      readyQueueRef.current.length < TARGET_READY_STACK
    ) {
      const slotPromise = createReadySlotPromise(genId);
      slotPromise.catch(() => {});
      readyQueueRef.current.push(slotPromise);
    }
  };

  useEffect(() => {
    if (lastFilterSigRef.current === filterSig) return;
    lastFilterSigRef.current = filterSig;

    generationIdRef.current += 1;
    candidatePoolRef.current = [];
    readyQueueRef.current = [];
    isFetchingPoolRef.current = null;

    topUpReadyQueue(generationIdRef.current);
  }, [filterSig]);

  const handleRerollCenter = async () => {
    if (isRerollingRef.current || isLoadingTrack) return;
    isRerollingRef.current = true;
    setError(null);

    try {
      const activeGen = generationIdRef.current;
      const deck = deckRef.current;

      // 1. Tape-stop currently playing record first
      if (deck && deck.isPlaying()) {
        await deck.tapeStop(340);
      }

      // 2. Pop next track & immediately start preparing the next background track
      topUpReadyQueue(activeGen);
      const nextSlotPromise = readyQueueRef.current.shift();
      topUpReadyQueue(activeGen);

      if (!nextSlotPromise) return;

      setIsLoadingTrack(true);
      setLoadingMessage("DROPPING NEEDLE...");

      const readyItem = await nextSlotPromise;
      if (activeGen !== generationIdRef.current) return;

      setCurrentCandidate(readyItem.candidate);
      setActiveSample(readyItem.sample);
      setIsLoadingTrack(false);
      setLoadingMessage("");

      // 3. Decode & spin up with analog tape-start
      if (deck) {
        await deck.loadAndTapeStart(
          readyItem.sample.streamUrl,
          readyItem.sample.masterWavPath,
          300
        );
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoadingTrack(false);
      setLoadingMessage("");
      isRerollingRef.current = false;
    }
  };

  const handlePlay = async () => {
    if (!deckRef.current || !activeSample || isRerollingRef.current) return;
    await deckRef.current.tapeStartCurrent(300).catch((err) => setError(String(err)));
  };

  const handleStop = async () => {
    if (!deckRef.current || isRerollingRef.current) return;
    await deckRef.current.tapeStop(340);
  };

  const handleOpenTrim = async () => {
    if (deckRef.current && deckRef.current.isPlaying()) {
      await deckRef.current.tapeStop(260);
    }
    setTrimModalOpen(true);
  };

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

  const handleOpenSamples = async () => {
    await invoke("open_samples_folder").catch((err) => setError(String(err)));
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[#15171c] text-[#eae5dc]">
    <TopBar
        queryUsed={queryUsed}
        queryTag={queryTag}
        savedCount={savedCount}
        settingsOpen={settingsOpen}
        onOpenSamplesFolder={handleOpenSamples}
        onOpenSettings={() => setSettingsOpen((prev) => !prev)}
      />

      <TurntableStage
        currentCandidate={currentCandidate}
        activeSample={activeSample}
        isPlaying={isPlaying}
        isLoadingTrack={isLoadingTrack}
        loadingMessage={loadingMessage}
        errorMsg={errorMsg}
        vuLevel={vuLevel}
        masterVolume={masterVolume}
        exportFormat={exportFormat}
        settingsOpen={settingsOpen}
        trimOpen={trimModalOpen}
        windowPreset={windowPreset}
        onChangeWindowPreset={handleChangeWindowPreset}
        onCloseSettings={() => setSettingsOpen(false)}
        onChangeVolume={setMasterVolume}
        onToggleFormat={setExportFormat}
        onRerollCenter={handleRerollCenter}
        onPlay={handlePlay}
        onStop={handleStop}
        onOpenTrim={handleOpenTrim}
        onCloseTrim={() => setTrimModalOpen(false)}
        onUpdateSample={(updated) => {
          setActiveSample(updated);
          syncSamplesCountFromDisk();
        }}
      />
    </div>
  );
}

export default App;