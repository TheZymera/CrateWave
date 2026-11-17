import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { TopBar, type WindowSizePreset } from "./components/TopBar";
import { TurntableStage } from "./components/TurntableStage";
import { WaveformChopper } from "./components/WaveformChopper";
import { SettingsModal } from "./components/SettingsModal";
import { useCrateStore } from "./store/useCrateStore";
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

const TARGET_READY_STACK = 2;

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
  const [readyCount, setReadyCount] = useState(0);

  // Continuous 2-Track Ready Stack & Candidate Pool
  const candidatePoolRef = useRef<SampleCandidate[]>([]);
  const readyStackRef = useRef<ReadyDeckItem[]>([]);
  const isMaintainingRef = useRef(false);
  const generationIdRef = useRef(0);
  const lastFilterSigRef = useRef("");
  const extendedIdsRef = useRef<Set<string>>(new Set());

  // HTML5 Audio + Web Audio Analyser
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
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

  const refreshStorageCount = () => {
    invoke<StorageInfo>("init_storage")
      .then((info) => setStorageInfo(info.samplesDir, info.seenCount))
      .catch((err) => setError(String(err)));
  };

  useEffect(() => {
    refreshStorageCount();
  }, []);

  // Initialize persistent Audio element
  useEffect(() => {
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.volume = masterVolume;

    audio.addEventListener("play", () => setIsPlaying(true));
    audio.addEventListener("pause", () => setIsPlaying(false));
    audio.addEventListener("ended", () => setIsPlaying(false));

    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = masterVolume;
    }
  }, [masterVolume]);

  // Auto-extend 90s-capped tracks when listening approaches the end
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentCandidate || !activeSample) return;

    const handleTimeUpdate = async () => {
      const dur = audio.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;

      const isCappedAround90 = dur >= 84 && dur <= 96;
      const nearEnd = audio.currentTime >= dur - 18;

      if (
        isCappedAround90 &&
        nearEnd &&
        !extendedIdsRef.current.has(currentCandidate.id)
      ) {
        extendedIdsRef.current.add(currentCandidate.id);
        try {
          const extended = await invoke<ActiveSample>("extend_sample_audio", {
            candidate: currentCandidate,
            mode: filters.mode,
            format: exportFormat,
          });
          const resumeTime = audio.currentTime;
          const wasPlaying = !audio.paused;
          setActiveSample(extended);
          audio.src = convertFileSrc(extended.masterWavPath);
          audio.currentTime = resumeTime;
          if (wasPlaying) {
            await audio.play();
          }
        } catch {
          // Keep current 90s buffer playing uninterrupted if source cannot extend
        }
      }
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    return () => audio.removeEventListener("timeupdate", handleTimeUpdate);
  }, [currentCandidate, activeSample, filters.mode, exportFormat]);

  // 60fps Master VU Needle Loop
  useEffect(() => {
    const dataArray = new Uint8Array(128);

    const tick = () => {
      if (isPlaying && analyserRef.current) {
        analyserRef.current.getByteTimeDomainData(dataArray);
        let sumSq = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const norm = (dataArray[i] - 128) / 128;
          sumSq += norm * norm;
        }
        const rms = Math.sqrt(sumSq / dataArray.length);
        setVuLevel(Math.min(1.12, rms * 3.8 * (0.4 + masterVolume * 0.6)));
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
  }, [isPlaying, masterVolume]);

  const ensureAudioAnalyser = () => {
    if (!audioRef.current || audioCtxRef.current) return;
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaElementSource(audioRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
    } catch (e) {
      console.warn("WebAudio analyser fallback:", e);
    }
  };

  // Continuous background worker: ALWAYS keeps 2 tracks pre-loaded & ready in stack
  const maintainReadyStack = async (genId: number) => {
    if (isMaintainingRef.current) return;
    isMaintainingRef.current = true;

    try {
      while (
        genId === generationIdRef.current &&
        readyStackRef.current.length < TARGET_READY_STACK
      ) {
        if (candidatePoolRef.current.length === 0) {
          const res = await invoke<RollResponse>("roll_crate", {
            filters: { ...filters, count: 4 },
          });
          if (genId !== generationIdRef.current) break;
          setRollResult(res.queryUsed, res.queryTag, res.candidates);
          candidatePoolRef.current.push(...res.candidates);
        }

        const nextCand = candidatePoolRef.current.shift();
        if (!nextCand) break;

        try {
          const sample = await invoke<ActiveSample>("load_and_chop_sample", {
            candidate: nextCand,
            mode: filters.mode,
            format: exportFormat,
          });
          if (genId !== generationIdRef.current) break;

          readyStackRef.current.push({ candidate: nextCand, sample });
          setReadyCount(readyStackRef.current.length);
          refreshStorageCount();
        } catch {
          // Skip broken candidate automatically and continue filling ready stack
        }
      }
    } finally {
      isMaintainingRef.current = false;
    }
  };

  // Reset & immediately pre-warm 2 ready tracks whenever filters/mode change
  useEffect(() => {
    if (lastFilterSigRef.current === filterSig) return;
    lastFilterSigRef.current = filterSig;

    generationIdRef.current += 1;
    candidatePoolRef.current = [];
    readyStackRef.current = [];
    setReadyCount(0);
    isMaintainingRef.current = false;

    maintainReadyStack(generationIdRef.current);
  }, [filterSig]);

  const startDeckPlayback = async (item: ReadyDeckItem) => {
    setCurrentCandidate(item.candidate);
    setActiveSample(item.sample);

    if (audioRef.current) {
      ensureAudioAnalyser();
      if (audioCtxRef.current?.state === "suspended") {
        await audioCtxRef.current.resume();
      }
      audioRef.current.src = convertFileSrc(item.sample.masterWavPath);
      await audioRef.current.play();
    }
  };

  // Click Center Carton Label -> Instant Pop from Ready Stack + Trigger Background Refill
  const handleRerollCenter = async () => {
    if (isLoadingTrack) return;
    setError(null);

    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlaying(false);

    const activeGen = generationIdRef.current;

    // Fast path: pop an already-loaded track from our 2-track ready stack
    const readyItem = readyStackRef.current.shift();
    if (readyItem) {
      setReadyCount(readyStackRef.current.length);
      try {
        await startDeckPlayback(readyItem);
      } catch (err) {
        setError(String(err));
      }
      // Immediately replenish stack back to 2 ready tracks
      maintainReadyStack(activeGen);
      return;
    }

    // Cold-start path: fetch + load Track 1 immediately, then fill 2 ready tracks behind it
    setIsLoadingTrack(true);
    setLoadingMessage("DIGGING CRATE (90S FAST CAPTURE)...");

    try {
      if (candidatePoolRef.current.length === 0) {
        const res = await invoke<RollResponse>("roll_crate", {
          filters: { ...filters, count: 4 },
        });
        setRollResult(res.queryUsed, res.queryTag, res.candidates);
        candidatePoolRef.current.push(...res.candidates);
      }

      const firstCand = candidatePoolRef.current.shift();
      if (!firstCand) {
        throw new Error("No tracks found for this filter combination.");
      }

      setCurrentCandidate(firstCand);
      setLoadingMessage("DROPPING NEEDLE...");

      const firstSample = await invoke<ActiveSample>("load_and_chop_sample", {
        candidate: firstCand,
        mode: filters.mode,
        format: exportFormat,
      });
      refreshStorageCount();

      await startDeckPlayback({ candidate: firstCand, sample: firstSample });

      // Start background worker to fill the 2-track ready stack
      maintainReadyStack(activeGen);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoadingTrack(false);
      setLoadingMessage("");
    }
  };

  const handlePlay = async () => {
    if (!audioRef.current || !activeSample) return;
    ensureAudioAnalyser();
    if (audioCtxRef.current?.state === "suspended") {
      await audioCtxRef.current.resume();
    }
    await audioRef.current.play().catch(console.error);
  };

  const handleStop = () => {
    if (!audioRef.current) return;
    audioRef.current.pause();
  };

  const handleOpenTrim = () => {
    if (audioRef.current) {
      audioRef.current.pause();
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
        queueStatus={`READY STACK: ${readyCount}/${TARGET_READY_STACK}`}
        onOpenSamplesFolder={handleOpenSamples}
        onOpenSettings={() => setSettingsOpen(true)}
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
        onChangeVolume={setMasterVolume}
        onToggleFormat={setExportFormat}
        onRerollCenter={handleRerollCenter}
        onPlay={handlePlay}
        onStop={handleStop}
        onOpenTrim={handleOpenTrim}
      />

      {trimModalOpen && activeSample && (
        <WaveformChopper
          sample={activeSample}
          exportFormat={exportFormat}
          onUpdateSample={(updated) => {
            setActiveSample(updated);
            refreshStorageCount();
          }}
          onClose={() => setTrimModalOpen(false)}
        />
      )}

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