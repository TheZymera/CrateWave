import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/dist/plugins/regions.esm.js";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { Play, Pause, Scissors, GripVertical, ArrowLeft, Check } from "lucide-react";
import { VuMeter } from "./VuMeter";
import { useCrateStore } from "../store/useCrateStore";
import type { ActiveSample, ExportFormat } from "../types/crate";

interface WaveformChopperProps {
  sample: ActiveSample;
  exportFormat: ExportFormat;
  onUpdateSample: (updated: ActiveSample) => void;
  onClose: () => void;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

export function WaveformChopper({
  sample,
  exportFormat,
  onUpdateSample,
  onClose,
}: WaveformChopperProps) {
  const mode = useCrateStore((state) => state.filters.mode);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionRef = useRef<Region | null>(null);

  // Dedicated Web Audio Engine for Loop Playback + Real Stereo L/R Analysers
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserLRef = useRef<AnalyserNode | null>(null);
  const analyserRRef = useRef<AnalyserNode | null>(null);
  const playingRef = useRef(false);
  const playStartCtxTimeRef = useRef(0);
  const playStartOffsetRef = useRef(0);
  const loopBoundsRef = useRef<{ start: number; end: number }>({
    start: 0,
    end: Math.min(sample.durationSec || 16, 16),
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(() =>
    Math.min(sample.durationSec || 16, 16)
  );
  const [isExporting, setIsExporting] = useState(false);
  const [isAddedToSamples, setIsAddedToSamples] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [vuLeft, setVuLeft] = useState(0);
  const [vuRight, setVuRight] = useState(0);
  const [dragFilePath, setDragFilePath] = useState(sample.masterWavPath);

  useEffect(() => {
    setDragFilePath(sample.masterWavPath);
    setIsAddedToSamples(false);
    setExportError(null);
  }, [sample.masterWavPath]);

  const stopWebAudioLoop = () => {
    playingRef.current = false;
    setIsPlaying(false);
    setVuLeft(0);
    setVuRight(0);

    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.onended = null;
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch {
        // Already stopped
      }
      sourceNodeRef.current = null;
    }
  };

  const startWebAudioLoop = async (fromOffsetSec?: number) => {
    let ctx = audioCtxRef.current;
    if (!ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AudioCtx();
      audioCtxRef.current = ctx;
    }
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    let buffer = audioBufferRef.current;
    if (!buffer) {
      const audioUrl = sample.streamUrl || convertFileSrc(sample.masterWavPath);
      const resp = await fetch(audioUrl);
      const arr = await resp.arrayBuffer();
      buffer = await ctx.decodeAudioData(arr.slice(0));
      audioBufferRef.current = buffer;
    }

    stopWebAudioLoop();

    const { start, end } = loopBoundsRef.current;
    const safeStart = Math.max(0, Math.min(start, buffer.duration - 0.05));
    const safeEnd = Math.max(safeStart + 0.1, Math.min(end, buffer.duration));
    const offset =
      fromOffsetSec !== undefined &&
      fromOffsetSec >= safeStart &&
      fromOffsetSec < safeEnd
        ? fromOffsetSec
        : safeStart;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = safeStart;
    src.loopEnd = safeEnd;

    const splitter = ctx.createChannelSplitter(2);
    const analyserL = ctx.createAnalyser();
    const analyserR = ctx.createAnalyser();
    analyserL.fftSize = 256;
    analyserR.fftSize = 256;
    analyserL.smoothingTimeConstant = 0.6;
    analyserR.smoothingTimeConstant = 0.6;

    src.connect(splitter);
    splitter.connect(analyserL, 0);
    splitter.connect(
      analyserR,
      buffer.numberOfChannels > 1 ? 1 : 0
    );

    // Connect audio output to speakers
    src.connect(ctx.destination);

    analyserLRef.current = analyserL;
    analyserRRef.current = analyserR;
    sourceNodeRef.current = src;

    playStartCtxTimeRef.current = ctx.currentTime;
    playStartOffsetRef.current = offset;
    playingRef.current = true;
    setIsPlaying(true);

    src.start(0, offset);
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const audioUrl = sample.streamUrl || convertFileSrc(sample.masterWavPath);
    audioBufferRef.current = null;

    // Pre-decode AudioBuffer immediately on mount
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    audioCtxRef.current = ctx;

    fetch(audioUrl)
      .then((r) => r.arrayBuffer())
      .then((arr) => ctx.decodeAudioData(arr.slice(0)))
      .then((decoded) => {
        audioBufferRef.current = decoded;
      })
      .catch((err) => console.error("Trim decode error:", err));

    const regions = RegionsPlugin.create();
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#3b230d",
      progressColor: "#9a3412",
      cursorColor: "#dc2626",
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      height: 145,
      normalize: true,
      interact: true,
      url: audioUrl,
      plugins: [regions],
    });

    // Mute WaveSurfer's internal HTML5 element so only our WebAudio loop engine plays
    ws.setVolume(0);

    ws.on("ready", () => {
      const dur = ws.getDuration();
      const initialEnd = Math.min(dur, 16);
      setStartSec(0);
      setEndSec(initialEnd);
      loopBoundsRef.current = { start: 0, end: initialEnd };

      const reg = regions.addRegion({
        start: 0,
        end: initialEnd,
        color: "rgba(220, 38, 38, 0.22)",
        drag: true,
        resize: true,
      });

      reg.on("update", () => {
        setStartSec(reg.start);
        setEndSec(reg.end);
        loopBoundsRef.current = { start: reg.start, end: reg.end };
        if (sourceNodeRef.current) {
          sourceNodeRef.current.loopStart = reg.start;
          sourceNodeRef.current.loopEnd = Math.max(reg.start + 0.1, reg.end);
        }
        setIsAddedToSamples(false);
        setExportError(null);
      });

      regionRef.current = reg;
    });

    // If user clicks directly on waveform, jump loop position there
    ws.on("interaction", (newTime) => {
      if (playingRef.current) {
        startWebAudioLoop(newTime);
      }
    });

    wsRef.current = ws;

    return () => {
      stopWebAudioLoop();
      ws.destroy();
      wsRef.current = null;
      ctx.close().catch(() => {});
      audioCtxRef.current = null;
    };
  }, [sample.masterWavPath]);

  // 60fps Hardware AnalyserNode Loop for L/R VU Needles + Playhead Sync
  // 60fps Stereo VU Metering + Playhead Sync driven directly by AudioContext clock & PCM buffer
  useEffect(() => {
    if (!isPlaying) {
      setVuLeft(0);
      setVuRight(0);
      return;
    }

    let rafId = 0;
    let smoothL = 0;
    let smoothR = 0;

    const tick = () => {
      const ctx = audioCtxRef.current;
      const buf = audioBufferRef.current;

      if (playingRef.current && ctx && buf) {
        const { start, end } = loopBoundsRef.current;
        const loopLen = Math.max(0.1, end - start);
        const elapsed = Math.max(0, ctx.currentTime - playStartCtxTimeRef.current);
        const relPos =
          ((playStartOffsetRef.current - start + elapsed) % loopLen + loopLen) %
          loopLen;
        const currentSec = start + relPos;

        // 1. Move WaveSurfer cursor
        wsRef.current?.setTime(currentSec);

        // 2. Compute exact L/R RMS from the decoded AudioBuffer at `currentSec`
        const sr = buf.sampleRate;
        const centerIdx = Math.floor(currentSec * sr);
        const winSize = 1024;
        const iStart = Math.max(0, centerIdx - winSize / 2);
        const ch0 = buf.getChannelData(0);
        const ch1 = buf.getChannelData(buf.numberOfChannels > 1 ? 1 : 0);
        const iEnd = Math.min(ch0.length, iStart + winSize);
        const count = Math.max(1, iEnd - iStart);

        let sumL = 0;
        let sumR = 0;
        for (let i = iStart; i < iEnd; i++) {
          const l = ch0[i];
          const r = ch1[i];
          sumL += l * l;
          sumR += r * r;
        }

        const targetL = Math.min(1.15, Math.sqrt(sumL / count) * 4.2);
        const targetR = Math.min(1.15, Math.sqrt(sumR / count) * 4.2);

        // Smooth ballistic attack/release for authentic analog needle motion
        smoothL = smoothL + (targetL - smoothL) * 0.35;
        smoothR = smoothR + (targetR - smoothR) * 0.35;

        setVuLeft(smoothL);
        setVuRight(smoothR);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        togglePlayRegion();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const togglePlayRegion = () => {
    if (playingRef.current) {
      stopWebAudioLoop();
    } else {
      startWebAudioLoop(loopBoundsRef.current.start);
    }
  };

  const handleTrimAndExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setExportError(null);

    try {
      const exportedPath = await invoke<string>("export_trimmed_sample", {
        masterWavPath: sample.masterWavPath,
        title: sample.title,
        mode,
        startSec,
        endSec,
        format: exportFormat,
      });

      setDragFilePath(exportedPath);
      onUpdateSample({
        ...sample,
        trimStartSec: startSec,
        trimEndSec: endSec,
        format: exportFormat,
        exportedPath,
      });
      setIsAddedToSamples(true);
    } catch (err) {
      console.error("Trim failed:", err);
      setExportError(String(err));
    } finally {
      setIsExporting(false);
    }
  };

  const handleDragToDaw = async () => {
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

  return (
    <div className="fixed inset-0 z-50 chassis-mahogany flex flex-col justify-between p-5 border-4 border-[#180d0b] shadow-2xl">
      {/* Decorative Background Tape Reels */}
      <div className="absolute -top-24 left-1/2 -translate-x-1/2 flex gap-28 opacity-20 pointer-events-none">
        <div className="w-48 h-48 rounded-full border-8 border-[#d4af7a] bg-[#140b09]" />
        <div className="w-48 h-48 rounded-full border-8 border-[#d4af7a] bg-[#140b09]" />
      </div>

      {/* Top Champagne-Gold Pinstripe Header */}
      <div className="relative z-10 flex items-center justify-between border-b border-[#c9a36b]/35 pb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              stopWebAudioLoop();
              onClose();
            }}
            className="hw-key px-3 py-1.5 flex items-center gap-1.5 font-chassis text-xs font-bold tracking-wider uppercase cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>BACK TO TURNTABLE</span>
          </button>

          <div>
            <div className="font-label-vintage text-base font-extrabold text-[#f3dfb9] tracking-wide truncate max-w-lg">
              {sample.title}
            </div>
            <div className="font-mono-tech text-[10px] text-[#c9a36b]">
              ANALOG TAPE &amp; VU CHOPPER • {exportFormat.toUpperCase()} MASTER
            </div>
          </div>
        </div>

        {/* Dual Live L/R Analog VU Meters */}
        <div className="flex items-center gap-3">
          <VuMeter level={vuLeft} isPlaying={isPlaying} label="CH L • VU" compact />
          <VuMeter level={vuRight} isPlaying={isPlaying} label="CH R • VU" compact />
        </div>
      </div>

      {/* Error Banner if Export Fails */}
      {exportError && (
        <div className="relative z-20 mx-auto px-4 py-1.5 rounded bg-[#361116] border border-rose-500/70 text-rose-200 font-mono-tech text-xs">
          {exportError}
        </div>
      )}

      {/* Center: VU-Meter-Styled Trim Timeline Window */}
      <div className="relative z-10 my-3 rounded-xl bg-[#130b09] p-3 border-2 border-[#c9a36b]/45 shadow-[inset_0_4px_18px_rgba(0,0,0,0.95),0_10px_25px_rgba(0,0,0,0.85)]">
        <span className="absolute top-1.5 left-1.5 w-2 h-2 rounded-full bg-gradient-to-br from-[#f3dfb9] to-[#78582c]" />
        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-gradient-to-br from-[#f3dfb9] to-[#78582c]" />
        <span className="absolute bottom-1.5 left-1.5 w-2 h-2 rounded-full bg-gradient-to-br from-[#f3dfb9] to-[#78582c]" />
        <span className="absolute bottom-1.5 right-1.5 w-2 h-2 rounded-full bg-gradient-to-br from-[#f3dfb9] to-[#78582c]" />

        {/* Illuminated Warm-Amber VU Glass Bay */}
        <div className="relative rounded-lg overflow-hidden bg-[radial-gradient(ellipse_at_50%_60%,#ffe5a3_0%,#eab04d_62%,#9e6217_100%)] p-3">
          <div className="flex justify-between items-center font-mono-tech text-[10px] font-bold text-[#2b1804] border-b border-[#2b1804]/30 pb-1 mb-1 px-1">
            <span>-20 dB • [IN] {formatTime(startSec)}</span>
            <span className="tracking-[0.25em] font-chassis text-xs font-extrabold">
              VU TIMELINE • LOOP SLICE ({(endSec - startSec).toFixed(2)}S)
            </span>
            <span className="text-[#991b1b]">[OUT] {formatTime(endSec)} • +3 dB</span>
          </div>

          <div ref={containerRef} className="relative z-10 w-full cursor-ew-resize" />

          <div className="absolute inset-0 greasy-vu-glass pointer-events-none z-20" />
        </div>
      </div>

      {/* Bottom: 3D Hardware Controls + Native Drag-to-DAW Grip Pad */}
      <div className="relative z-10 flex items-center justify-between gap-4 pt-1">
        <div className="flex items-center gap-3">
          <button
            onClick={togglePlayRegion}
            className={`hw-key px-5 py-2.5 flex items-center gap-2 font-chassis text-sm font-extrabold tracking-widest uppercase cursor-pointer ${
              isPlaying ? "hw-key-lit-green" : ""
            }`}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            <span>{isPlaying ? "PAUSE LOOP" : "AUDITION LOOP (SPACE)"}</span>
          </button>

          <button
            onClick={handleTrimAndExport}
            disabled={isExporting}
            className={`hw-key px-5 py-2.5 flex items-center gap-2 font-chassis text-sm font-extrabold tracking-widest uppercase cursor-pointer disabled:opacity-50 ${
              isAddedToSamples ? "hw-key-lit-green" : "hw-key-lit-amber"
            }`}
          >
            {isAddedToSamples ? (
              <Check className="w-4 h-4 text-emerald-950" />
            ) : (
              <Scissors className="w-4 h-4" />
            )}
            <span>
              {isExporting
                ? "PRINTING..."
                : isAddedToSamples
                ? "ADDED TO SAMPLES"
                : "TRIM & EXPORT"}
            </span>
          </button>
        </div>

        {/* Native OS Drag-to-DAW Grip Pad */}
        <div
          onMouseDown={handleDragToDaw}
          title="Drag directly into Ableton, FL Studio, Logic, or Reaper"
          className="flex items-center gap-2.5 px-5 py-2.5 rounded-lg bg-gradient-to-b from-[#d8c39e] to-[#a88d63] border-2 border-[#3b2614] text-[#231407] shadow-[0_5px_0_#1a0e08,0_8px_16px_rgba(0,0,0,0.85)] cursor-grab active:cursor-grabbing hover:brightness-105 transition"
        >
          <GripVertical className="w-5 h-5" />
          <div className="flex flex-col">
            <span className="font-chassis text-sm font-extrabold tracking-[0.18em] leading-none">
              DRAG TO DAW
            </span>
            <span className="font-mono-tech text-[9px] font-bold opacity-80 mt-0.5">
              {dragFilePath.split(/[\\/]/).pop()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}