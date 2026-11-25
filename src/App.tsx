import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { TopBar, type WindowSizePreset } from "./components/TopBar";
import { TurntableStage } from "./components/TurntableStage";
import { useCrateStore } from "./store/useCrateStore";
import { TurntableAudioDeck } from "./utils/tapeAudioFx";
import {
  initFrontendLogger,
  logActivity,
  logError,
  logTask,
  logWarn,
} from "./utils/logger";

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
  buffer: AudioBuffer | null;
}

interface QueuedSlot {
  promise: Promise<ReadyDeckItem>;
  resolved: ReadyDeckItem | null;
}

const TARGET_READY_STACK = 3;
const ROLL_BATCH_SIZE = 4;
const MAX_CONCURRENT_WARM = 2;

const WINDOW_DIMS: Record<WindowSizePreset, [number, number]> = {
  small: [1100, 620],
  medium: [1470, 770],
  big: [1650, 930],
};

function App() {
  const [windowPreset, setWindowPreset] = useState<WindowSizePreset>("small");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [trimModalOpen, setTrimModalOpen] = useState(false);

  const [currentCandidate, setCurrentCandidate] = useState<SampleCandidate | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingTrack, setIsLoadingTrack] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [vuLevel, setVuLevel] = useState(0);
  const [masterVolume, setMasterVolume] = useState(0.85);

  const candidatePoolRef = useRef<SampleCandidate[]>([]);
  const readyQueueRef = useRef<QueuedSlot[]>([]);
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

  // Start session logger + disable default browser context menu
  useEffect(() => {
    initFrontendLogger();
    const preventContextMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", preventContextMenu);
    return () => window.removeEventListener("contextmenu", preventContextMenu);
  }, []);

  const syncSamplesCountFromDisk = () => {
    invoke<StorageInfo>("init_storage")
      .then((info) => setStorageInfo(info.samplesDir, info.seenCount))
      .catch((err) => {
        logError("STORAGE_INIT_FAIL", String(err));
        setError(String(err));
      });
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
          logTask("EXTEND_AUDIO", "Requesting full track extension", {
            id: currentCandidate.id,
            title: currentCandidate.title,
          });

          invoke<ActiveSample>("extend_sample_audio", {
            candidate: currentCandidate,
            mode: filters.mode,
            format: exportFormat,
          })
            .then((extended) => {
              logTask("EXTEND_AUDIO", "Full track buffer ready", {
                id: currentCandidate.id,
                durationSec: extended.durationSec,
              });
              setActiveSample(extended);
              return deck.swapExtendedBuffer(
                extended.streamUrl,
                extended.masterWavPath
              );
            })
            .catch((err) => {
              logWarn("EXTEND_AUDIO_FAIL", String(err), {
                id: currentCandidate.id,
              });
            });
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

  const prefetchCandidatePool = (genId: number) => {
    if (isFetchingPoolRef.current) return;
    isFetchingPoolRef.current = (async () => {
      try {
        const res = await invoke<RollResponse>("roll_crate", {
          filters: { ...filters, cardCount: ROLL_BATCH_SIZE },
        });
        if (genId === generationIdRef.current) {
          candidatePoolRef.current.push(...res.candidates);
        }
      } catch (err) {
        logWarn("BACKGROUND_ROLL_WARN", String(err));
      } finally {
        isFetchingPoolRef.current = null;
      }
    })();
  };

  const ensureCandidatePool = async (genId: number) => {
    if (candidatePoolRef.current.length > 0) {
      if (candidatePoolRef.current.length <= 2) {
        prefetchCandidatePool(genId);
      }
      return;
    }

    if (!isFetchingPoolRef.current) {
      isFetchingPoolRef.current = (async () => {
        try {
          const res = await invoke<RollResponse>("roll_crate", {
            filters: { ...filters, cardCount: ROLL_BATCH_SIZE },
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

    while (genId === generationIdRef.current && attempts < 5) {
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

        let buffer: AudioBuffer | null = null;
        if (deckRef.current) {
          try {
            buffer = await deckRef.current.predecodeBuffer(
              sample.streamUrl,
              sample.masterWavPath
            );
          } catch (decodeErr) {
            logWarn("PREDECODE_WARN", String(decodeErr), { id: cand.id });
          }
        }

        if (genId !== generationIdRef.current) {
          throw new Error("Filter changed");
        }

        return { candidate: cand, sample, buffer };
      } catch (err) {
        logWarn("PRELOAD_SLOT_FAIL", String(err), {
          id: cand.id,
          attempt: attempts,
        });
        lastErr = err;
      }
    }
    throw lastErr;
  };

  // Warms up to 2 background slots in parallel so 12-15s YouTube rips finish before rapid skips
  const topUpReadyQueue = (genId: number) => {
    let pendingCount = readyQueueRef.current.filter((s) => s.resolved === null).length;

    while (
      genId === generationIdRef.current &&
      readyQueueRef.current.length < TARGET_READY_STACK &&
      pendingCount < MAX_CONCURRENT_WARM
    ) {
      const slot: QueuedSlot = {
        promise: Promise.resolve(null as unknown as ReadyDeckItem),
        resolved: null,
      };
      slot.promise = createReadySlotPromise(genId)
        .then((item) => {
          if (genId === generationIdRef.current) {
            slot.resolved = item;
            topUpReadyQueue(genId);
          }
          return item;
        })
        .catch((err) => {
          readyQueueRef.current = readyQueueRef.current.filter((s) => s !== slot);
          if (genId === generationIdRef.current) {
            topUpReadyQueue(genId);
          }
          throw err;
        });
      slot.promise.catch(() => {});
      readyQueueRef.current.push(slot);
      pendingCount += 1;
    }
  };

  // Debounced (150ms) filter pre-warm with instant stale-generation cancellation
  useEffect(() => {
    const isInitial = lastFilterSigRef.current === "";
    const filterChanged = !isInitial && lastFilterSigRef.current !== filterSig;
    lastFilterSigRef.current = filterSig;

    if (filterChanged) {
      generationIdRef.current += 1;
      candidatePoolRef.current = [];
      readyQueueRef.current = [];
      isFetchingPoolRef.current = null;

      logActivity("FILTER_CHANGE", {
        mode: filters.mode,
        sampleType: filters.sampleType,
        region: filters.region,
        decade: filters.decade,
        duration: filters.duration,
        genre: filters.genre,
      });
    }

    const activeGen = generationIdRef.current;
    const delayMs = filterChanged ? 150 : 0;
    const timer = window.setTimeout(() => {
      if (activeGen === generationIdRef.current) {
        topUpReadyQueue(activeGen);
      }
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [filterSig]);

  const handleRerollCenter = async () => {
    if (isRerollingRef.current || isLoadingTrack) return;
    isRerollingRef.current = true;
    setError(null);
    const t0 = performance.now();

    logActivity("DIG_REROLL", {
      mode: filters.mode,
      region: filters.region,
      genre: filters.genre,
      warmSlots: readyQueueRef.current.filter((s) => s.resolved !== null).length,
    });

    try {
      const activeGen = generationIdRef.current;
      const deck = deckRef.current;

      if (deck && deck.isPlaying()) {
        await deck.tapeStop(340);
      }

      let readyItem: ReadyDeckItem | null = null;
      for (let tries = 0; tries < 2 && !readyItem; tries++) {
        topUpReadyQueue(activeGen);
        const nextSlot = readyQueueRef.current.shift();

        if (!nextSlot) break;

        if (nextSlot.resolved) {
          readyItem = nextSlot.resolved;
          topUpReadyQueue(activeGen);
        } else {
          setIsLoadingTrack(true);
          setLoadingMessage("DROPPING NEEDLE...");
          try {
            readyItem = await nextSlot.promise;
            topUpReadyQueue(activeGen);
          } catch (slotErr) {
            logWarn("SILENT_SLOT_PROMOTE", String(slotErr), { try: tries + 1 });
            if (tries === 1) throw slotErr;
          }
        }
      }

      if (!readyItem || activeGen !== generationIdRef.current) return;

      setCurrentCandidate(readyItem.candidate);
      setActiveSample(readyItem.sample);
      const vibeLabel = readyItem.candidate.queryTag.split(" • ")[0] || queryUsed;
      setRollResult(vibeLabel, readyItem.candidate.queryTag, []);
      setIsLoadingTrack(false);
      setLoadingMessage("");

      if (deck) {
        if (readyItem.buffer) {
          deck.playPredecodedBuffer(readyItem.buffer, 300);
        } else {
          await deck.loadAndTapeStart(
            readyItem.sample.streamUrl,
            readyItem.sample.masterWavPath,
            300
          );
        }
      }

      logTask("DIG_LOADED", "Track spinning", {
        id: readyItem.candidate.id,
        source: readyItem.candidate.source,
        title: readyItem.sample.title,
        warm: readyItem.buffer !== null,
        latencyMs: Math.round(performance.now() - t0),
      });
    } catch (err) {
      logError("DIG_FAILED", String(err));
      setError(String(err));
    } finally {
      setIsLoadingTrack(false);
      setLoadingMessage("");
      isRerollingRef.current = false;
    }
  };

  const handlePlay = async () => {
    if (!deckRef.current || !activeSample || isRerollingRef.current) return;
    logActivity("DECK_PLAY", { title: activeSample.title });
    await deckRef.current.tapeStartCurrent(300).catch((err) => {
      logError("DECK_PLAY_FAIL", String(err));
      setError(String(err));
    });
  };

  const handleStop = async () => {
    if (!deckRef.current || isRerollingRef.current) return;
    logActivity("DECK_STOP");
    await deckRef.current.tapeStop(340);
  };

  const handleOpenTrim = async () => {
    logActivity("TRIM_OPEN", { title: activeSample?.title });
    if (deckRef.current && deckRef.current.isPlaying()) {
      await deckRef.current.tapeStop(260);
    }
    setTrimModalOpen(true);
  };

  const handleChangeWindowPreset = async (preset: WindowSizePreset) => {
    logActivity("WINDOW_PRESET", { preset });
    setWindowPreset(preset);
    const [w, h] = WINDOW_DIMS[preset];
    try {
      const win = getCurrentWindow();
      await win.setSize(new LogicalSize(w, h));
      await win.center();
    } catch (err) {
      logError("WINDOW_RESIZE_FAIL", String(err));
    }
  };

  const handleOpenSamples = async () => {
    logActivity("OPEN_SAMPLES_FOLDER");
    await invoke("open_samples_folder").catch((err) => {
      logError("OPEN_SAMPLES_FAIL", String(err));
      setError(String(err));
    });
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
        onCloseTrim={() => {
          logActivity("TRIM_CLOSE");
          setTrimModalOpen(false);
        }}
        onUpdateSample={(updated) => {
          setActiveSample(updated);
          syncSamplesCountFromDisk();
        }}
      />
    </div>
  );
}

export default App;