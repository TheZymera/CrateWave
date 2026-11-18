import { useEffect, useRef, useState } from "react";
import { Disc3 } from "lucide-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { Turntable3DCanvas } from "./Turntable3DCanvas";
import { useCrateStore } from "../store/useCrateStore";
import type { WindowSizePreset } from "./TopBar";
import type {
  ActiveSample,
  DigMode,
  ExportFormat,
  SampleCandidate,
} from "../types/crate";

interface TurntableStageProps {
  currentCandidate: SampleCandidate | null;
  activeSample: ActiveSample | null;
  isPlaying: boolean;
  isLoadingTrack: boolean;
  loadingMessage: string;
  errorMsg: string | null;
  vuLevel: number;
  masterVolume: number;
  exportFormat: ExportFormat;
  settingsOpen: boolean;
  trimOpen: boolean;
  windowPreset: WindowSizePreset;
  onChangeWindowPreset: (preset: WindowSizePreset) => void;
  onCloseSettings: () => void;
  onChangeVolume: (val: number) => void;
  onToggleFormat: (fmt: ExportFormat) => void;
  onRerollCenter: () => void;
  onPlay: () => void;
  onStop: () => void;
  onOpenTrim: () => void;
  onCloseTrim: () => void;
  onUpdateSample: (updated: ActiveSample) => void;
}

export function TurntableStage({
  currentCandidate,
  activeSample,
  isPlaying,
  isLoadingTrack,
  loadingMessage,
  vuLevel,
  masterVolume,
  exportFormat,
  settingsOpen,
  trimOpen,
  windowPreset,
  onChangeWindowPreset,
  onCloseSettings,
  onChangeVolume,
  onToggleFormat,
  onRerollCenter,
  onPlay,
  onStop,
  onOpenTrim,
  onCloseTrim,
  onUpdateSample,
}: TurntableStageProps) {
  const { filters } = useCrateStore();

  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  const [trimRange, setTrimRange] = useState<[number, number]>([0, 1]);
  const [isAuditioning, setIsAuditioning] = useState(false);
  const [playheadProgress, setPlayheadProgress] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [dragFilePath, setDragFilePath] = useState<string | null>(null);
  const [trimError, setTrimError] = useState<string | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const decodedBufferRef = useRef<AudioBuffer | null>(null);
  const auditionSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const auditionGainRef = useRef<GainNode | null>(null);
  const auditionRafRef = useRef<number | null>(null);
  const loopBoundsRef = useRef<{ startSec: number; endSec: number }>({
    startSec: 0,
    endSec: 16,
  });

  const isTypeDisabled =
    filters.mode === "world_adventure" || filters.mode === "only_vocal";
  const isLengthDisabled = filters.mode === "world_adventure";
  const isGenreDisabled = filters.mode === "only_vocal";

  useEffect(() => {
    const patch: Partial<typeof filters> = {};
    if (isTypeDisabled && filters.sampleType !== "all") {
      patch.sampleType = "all";
    }
    if (isLengthDisabled && filters.duration !== "any") {
      patch.duration = "any";
    }
    if (isGenreDisabled && filters.genre !== "all") {
      patch.genre = "all";
    }
    if (Object.keys(patch).length > 0) {
      useCrateStore.setState((state) => ({
        filters: { ...state.filters, ...patch },
      }));
    }
  }, [
    filters.mode,
    filters.sampleType,
    filters.duration,
    filters.genre,
    isTypeDisabled,
    isLengthDisabled,
    isGenreDisabled,
  ]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseSettings();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen, onCloseSettings]);

  // Keep live audition gain synced with masterVolume knob
  useEffect(() => {
    if (auditionGainRef.current) {
      auditionGainRef.current.gain.value = masterVolume;
    }
  }, [masterVolume]);

  const stopAudition = () => {
    if (auditionRafRef.current !== null) {
      cancelAnimationFrame(auditionRafRef.current);
      auditionRafRef.current = null;
    }
    if (auditionSourceRef.current) {
      try {
        auditionSourceRef.current.onended = null;
        auditionSourceRef.current.stop();
        auditionSourceRef.current.disconnect();
      } catch {
        // already stopped
      }
      auditionSourceRef.current = null;
    }
    auditionGainRef.current = null;
    setIsAuditioning(false);
  };

  // Decode waveform peaks & initialize dragFilePath when activeSample changes
  useEffect(() => {
    stopAudition();
    setTrimRange([0, 1]);
    setPlayheadProgress(0);
    setTrimError(null);
    decodedBufferRef.current = null;

    if (!activeSample) {
      setWaveformPeaks([]);
      setDragFilePath(null);
      return;
    }

    setDragFilePath(activeSample.exportedPath || activeSample.masterWavPath);
    const audioUrl =
      activeSample.streamUrl || convertFileSrc(activeSample.masterWavPath);

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(audioUrl);
        const arrayBuf = await res.arrayBuffer();
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const ctx = audioCtxRef.current ?? new AudioCtx();
        audioCtxRef.current = ctx;
        const audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
        if (cancelled) return;

        decodedBufferRef.current = audioBuf;
        loopBoundsRef.current = { startSec: 0, endSec: audioBuf.duration };

        const channel = audioBuf.getChannelData(0);
        const bars = 140;
        const blockSize = Math.max(1, Math.floor(channel.length / bars));
        const rawPeaks: number[] = [];
        let maxPeak = 0.001;

        for (let i = 0; i < bars; i++) {
          const start = i * blockSize;
          let peak = 0;
          for (let j = 0; j < blockSize && start + j < channel.length; j += 4) {
            const abs = Math.abs(channel[start + j]);
            if (abs > peak) peak = abs;
          }
          if (peak > maxPeak) maxPeak = peak;
          rawPeaks.push(peak);
        }

        setWaveformPeaks(rawPeaks.map((p) => p / maxPeak));
      } catch (err) {
        console.error("Failed to decode waveform:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSample?.masterWavPath, activeSample?.streamUrl]);

  // Stop audition playback when leaving Trim Mode
  useEffect(() => {
    if (!trimOpen) {
      stopAudition();
    }
  }, [trimOpen]);

  const handleChangeTrimRange = (nextStart: number, nextEnd: number) => {
    setTrimRange([nextStart, nextEnd]);
    setTrimError(null);

    const dur =
      decodedBufferRef.current?.duration ?? activeSample?.durationSec ?? 16;
    const startSec = nextStart * dur;
    const endSec = Math.max(startSec + 0.08, nextEnd * dur);
    loopBoundsRef.current = { startSec, endSec };

    if (auditionSourceRef.current) {
      auditionSourceRef.current.loopStart = startSec;
      auditionSourceRef.current.loopEnd = endSec;
    }
  };

  const handleToggleAudition = async () => {
    if (isAuditioning) {
      stopAudition();
      return;
    }

    const buf = decodedBufferRef.current;
    if (!buf) return;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = audioCtxRef.current ?? new AudioCtx();
    audioCtxRef.current = ctx;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const dur = buf.duration;
    const startSec = Math.max(0, Math.min(trimRange[0] * dur, dur - 0.05));
    const endSec = Math.max(startSec + 0.08, Math.min(trimRange[1] * dur, dur));
    loopBoundsRef.current = { startSec, endSec };

    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.loop = true;
    source.loopStart = startSec;
    source.loopEnd = endSec;

    const gain = ctx.createGain();
    gain.gain.value = masterVolume;
    source.connect(gain);
    gain.connect(ctx.destination);

    const startedAt = ctx.currentTime;
    source.start(0, startSec);
    auditionSourceRef.current = source;
    auditionGainRef.current = gain;
    setIsAuditioning(true);

    const updatePlayhead = () => {
      if (!auditionSourceRef.current) return;
      const { startSec: curStart, endSec: curEnd } = loopBoundsRef.current;
      const loopLen = Math.max(0.08, curEnd - curStart);
      const elapsed = Math.max(0, ctx.currentTime - startedAt);
      const rel = ((elapsed % loopLen) + loopLen) % loopLen;
      setPlayheadProgress((curStart + rel) / dur);
      auditionRafRef.current = requestAnimationFrame(updatePlayhead);
    };
    auditionRafRef.current = requestAnimationFrame(updatePlayhead);
  };

  const handleExportTrim = async () => {
    if (!activeSample || isExporting) return;
    setIsExporting(true);
    setTrimError(null);

    const dur =
      decodedBufferRef.current?.duration ?? activeSample.durationSec ?? 16;
    const startSec = trimRange[0] * dur;
    const endSec = Math.max(startSec + 0.1, trimRange[1] * dur);

    try {
      const exportedPath = await invoke<string>("export_trimmed_sample", {
        masterWavPath: activeSample.masterWavPath,
        title: activeSample.title,
        mode: filters.mode,
        startSec,
        endSec,
        format: exportFormat,
      });

      setDragFilePath(exportedPath);
      onUpdateSample({
        ...activeSample,
        trimStartSec: startSec,
        trimEndSec: endSec,
        format: exportFormat,
        exportedPath,
      });
    } catch (err) {
      console.error("Trim failed:", err);
      setTrimError(String(err));
    } finally {
      setIsExporting(false);
    }
  };

  const handleDragToDaw = async () => {
    if (!dragFilePath) return;
    try {
      const iconPath = await invoke<string>("get_drag_icon_path");
      await startDrag({
        item: [dragFilePath],
        icon: iconPath,
      });
    } catch (err) {
      console.error("Native drag failed:", err);
    }
  };

  const updateFilter = <K extends keyof typeof filters>(
    key: K,
    value: (typeof filters)[K]
  ) => {
    useCrateStore.setState((state) => ({
      filters: {
        ...state.filters,
        [key]: value,
      },
    }));
  };

  const sourceLabel = (currentCandidate?.source || "CRATE").toUpperCase();
  const trackTitle =
    activeSample?.title ||
    currentCandidate?.title ||
    "PRESS CENTER LABEL TO DIG";
  const trackSub = activeSample
    ? `${sourceLabel} • ${activeSample.durationSec.toFixed(1)}S • CLICK CENTER`
    : currentCandidate
    ? `${currentCandidate.channel} • ${sourceLabel}`
    : "CRATEWAVE HI-FI • 33⅓ RPM";

  return (
    <main className="relative flex-1 w-full pointer-events-none">
      {/* Full-Screen 3D WebGL Analog Studio Room & PBR Hardware Turntable */}
      <div className="pointer-events-auto">
        <Turntable3DCanvas
          windowPreset={windowPreset}
          onChangeWindowPreset={onChangeWindowPreset}
          title={trackTitle}
          subtitle={trackSub}
          activeMode={filters.mode}
          isPlaying={isPlaying}
          isLoading={isLoadingTrack}
          hasActiveSample={Boolean(activeSample)}
          vuLevel={vuLevel}
          masterVolume={masterVolume}
          settingsOpen={settingsOpen}
          trimOpen={trimOpen}
          waveformPeaks={waveformPeaks}
          sampleDuration={
            decodedBufferRef.current?.duration ?? activeSample?.durationSec ?? 16
          }
          trimStart={trimRange[0]}
          trimEnd={trimRange[1]}
          playheadProgress={playheadProgress}
          isAuditioning={isAuditioning}
          isExporting={isExporting}
          exportedFilePath={dragFilePath}
          onSelectMode={(mode: DigMode) => updateFilter("mode", mode)}
          onClickCenterLabel={onRerollCenter}
          onPlay={onPlay}
          onStop={onStop}
          onOpenTrim={onOpenTrim}
          onCloseTrim={onCloseTrim}
          onChangeVolume={onChangeVolume}
          onChangeTrimRange={handleChangeTrimRange}
          onToggleAudition={handleToggleAudition}
          onExportTrim={handleExportTrim}
          onDragExportToDaw={handleDragToDaw}
        />
      </div>

      {/* Floating Digging Status Pill */}
      {isLoadingTrack && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1 rounded-full bg-[#1c1612]/95 border border-[#ffb347]/75 text-[#ffd27d] font-mono-tech text-[10px] shadow-2xl flex items-center gap-1.5">
          <Disc3 className="w-3.5 h-3.5 animate-spin text-[#ffb347]" />
          <span>{loadingMessage || "DIGGING CRATE..."}</span>
        </div>
      )}

      {/* Floating Trim Error Pill (if export fails) */}
      {trimOpen && trimError && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-4 py-1.5 rounded bg-[#361116]/95 border border-rose-500/75 text-rose-200 font-mono-tech text-xs shadow-2xl">
          {trimError}
        </div>
      )}

      {/* Bottom-Right Recessed Warm-Metal Filter Control Plate */}
      {!settingsOpen && !trimOpen && (
        <div className="absolute bottom-4 right-5 z-20 w-60 rounded-xl bg-gradient-to-b from-[#2b2622]/95 to-[#1b1815]/95 backdrop-blur-xs border border-[#c9a36b]/35 p-2.5 shadow-[inset_0_2px_8px_rgba(0,0,0,0.9),0_12px_28px_rgba(0,0,0,0.88)] pointer-events-auto">
          <div className="flex items-center justify-between border-b border-[#c9a36b]/25 pb-1.5 mb-2">
            <span className="font-chassis text-[10px] font-bold uppercase tracking-[0.16em] text-[#e6d5b8]">
              CRATE FILTERS
            </span>
            <div className="flex items-center bg-[#120f0d] p-0.5 rounded border border-[#4a3c2c] font-mono-tech text-[9px]">
              <button
                onClick={() => onToggleFormat("wav")}
                className={`px-1.5 py-0.5 rounded cursor-pointer transition ${
                  exportFormat === "wav"
                    ? "bg-[#ffb347] text-[#1a1308] font-bold"
                    : "text-[#a89b88] hover:text-white"
                }`}
              >
                WAV
              </button>
              <button
                onClick={() => onToggleFormat("mp3_320")}
                className={`px-1.5 py-0.5 rounded cursor-pointer transition ${
                  exportFormat === "mp3_320"
                    ? "bg-[#ffb347] text-[#1a1308] font-bold"
                    : "text-[#a89b88] hover:text-white"
                }`}
              >
                MP3
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
            {/* TYPE */}
            <label className="flex flex-col gap-0.5">
              <span className="font-chassis text-[9px] font-bold uppercase text-[#b5a48b]">
                TYPE {isTypeDisabled ? "(LOCKED)" : ""}
              </span>
              <select
                disabled={isTypeDisabled}
                value={isTypeDisabled ? "all" : filters.sampleType}
                onChange={(e) =>
                  updateFilter("sampleType", e.target.value as typeof filters.sampleType)
                }
                className="bg-[#14110e] border border-[#3d3328] rounded px-1.5 py-1 text-[#f2eadc] font-chassis text-xs outline-none focus:border-[#ffb347] disabled:opacity-35 disabled:cursor-not-allowed"
              >
                <option value="all">All Types</option>
                <option value="drums">Drum Breaks</option>
                <option value="melody">Melody / Keys</option>
                <option value="bass">Bassline</option>
                <option value="vocals">Vocals</option>
                <option value="fx">FX / Texture</option>
                <option value="full_track">Full Track</option>
              </select>
            </label>

            {/* REGION */}
            <label className="flex flex-col gap-0.5">
              <span className="font-chassis text-[9px] font-bold uppercase text-[#b5a48b]">
                REGION
              </span>
              <select
                value={filters.region}
                onChange={(e) =>
                  updateFilter("region", e.target.value as typeof filters.region)
                }
                className="bg-[#14110e] border border-[#3d3328] rounded px-1.5 py-1 text-[#f2eadc] font-chassis text-xs outline-none focus:border-[#ffb347]"
              >
                <option value="all">Any Region</option>
                <option value="france">France</option>
                <option value="japan">Japan</option>
                <option value="brazil">Brazil</option>
                <option value="italy">Italy</option>
                <option value="turkey">Turkey</option>
                <option value="ethiopia">Ethiopia</option>
                <option value="india">India</option>
                <option value="ussr">USSR / Soviet</option>
                <option value="caribbean">Caribbean</option>
                <option value="africa">Africa</option>
                <option value="latin_america">Latin America</option>
                <option value="middle_east">Middle East</option>
                <option value="europe">Europe</option>
                <option value="asia">Asia</option>
              </select>
            </label>

            {/* DECADE */}
            <label className="flex flex-col gap-0.5">
              <span className="font-chassis text-[9px] font-bold uppercase text-[#b5a48b]">
                DECADE
              </span>
              <select
                value={filters.decade}
                onChange={(e) =>
                  updateFilter("decade", e.target.value as typeof filters.decade)
                }
                className="bg-[#14110e] border border-[#3d3328] rounded px-1.5 py-1 text-[#f2eadc] font-chassis text-xs outline-none focus:border-[#ffb347]"
              >
                <option value="all">Any Era</option>
                <option value="1950s">1950s</option>
                <option value="1960s">1960s</option>
                <option value="1970s">1970s</option>
                <option value="1980s">1980s</option>
                <option value="1990s">1990s</option>
                <option value="2000s">2000s</option>
                <option value="2010s">2010s</option>
              </select>
            </label>

            {/* LENGTH */}
            <label className="flex flex-col gap-0.5">
              <span className="font-chassis text-[9px] font-bold uppercase text-[#b5a48b]">
                LENGTH {isLengthDisabled ? "(LOCKED)" : ""}
              </span>
              <select
                disabled={isLengthDisabled}
                value={isLengthDisabled ? "all" : filters.duration}
                onChange={(e) =>
                  updateFilter("duration", e.target.value as typeof filters.duration)
                }
                className="bg-[#14110e] border border-[#3d3328] rounded px-1.5 py-1 text-[#f2eadc] font-chassis text-xs outline-none focus:border-[#ffb347] disabled:opacity-35 disabled:cursor-not-allowed"
              >
                <option value="all">Any Length</option>
                <option value="shorts">Shorts (&lt;60s)</option>
                <option value="short">Short (1–3m)</option>
                <option value="medium">Medium (3–8m)</option>
                <option value="long">Long (8m+)</option>
              </select>
            </label>

            {/* GENRE */}
            <label className="col-span-2 flex flex-col gap-0.5">
              <span className="font-chassis text-[9px] font-bold uppercase text-[#b5a48b]">
                GENRE {isGenreDisabled ? "(LOCKED)" : ""}
              </span>
              <select
                disabled={isGenreDisabled}
                value={isGenreDisabled ? "all" : filters.genre}
                onChange={(e) =>
                  updateFilter("genre", e.target.value as typeof filters.genre)
                }
                className="bg-[#14110e] border border-[#3d3328] rounded px-1.5 py-1 text-[#f2eadc] font-chassis text-xs outline-none focus:border-[#ffb347] disabled:opacity-35 disabled:cursor-not-allowed"
              >
                <option value="all">All Genres</option>
                <option value="jazz">Jazz</option>
                <option value="funk">Funk</option>
                <option value="soul">Soul</option>
                <option value="rock">Rock / Psych</option>
                <option value="electronic">Electronic / Synth</option>
                <option value="hip_hop">Hip Hop</option>
                <option value="latin">Latin / Bossa</option>
                <option value="ambient">Ambient / Library</option>
                <option value="classical">Classical</option>
                <option value="folk">Folk / Traditional</option>
              </select>
            </label>
          </div>
        </div>
      )}
    </main>
  );
}