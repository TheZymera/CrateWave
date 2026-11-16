import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/dist/plugins/regions.esm.js";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  Play,
  Pause,
  Repeat,
  Scissors,
  GripVertical,
  FolderOpen,
  ArrowLeft,
  ZoomIn,
  Check,
} from "lucide-react";
import type { ActiveSample, DigMode, ExportFormat } from "../types/crate";

interface WaveformChopperProps {
  sample: ActiveSample;
  mode: DigMode;
  exportFormat: ExportFormat;
  onUpdateSample: (updated: ActiveSample) => void;
  onBackToCards: () => void;
}

function formatTimeMs(sec: number): string {
  const safe = Math.max(0, sec);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${tenths}`;
}

export function WaveformChopper({
  sample,
  mode,
  exportFormat,
  onUpdateSample,
  onBackToCards,
}: WaveformChopperProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionRef = useRef<Region | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [loopRegion, setLoopRegion] = useState(true);
  const [zoom, setZoom] = useState(0);
  const [trimStart, setTrimStart] = useState(sample.trimStartSec);
  const [trimEnd, setTrimEnd] = useState(sample.trimEndSec);
  const [isRendering, setIsRendering] = useState(false);
  const [justTrimmed, setJustTrimmed] = useState(false);
  const [dragIconPath, setDragIconPath] = useState<string>("");

  const loopRef = useRef(loopRegion);
  loopRef.current = loopRegion;

  useEffect(() => {
    invoke<string>("get_drag_icon_path")
      .then(setDragIconPath)
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#7E74A8",
      progressColor: "#F28B76",
      cursorColor: "#FFFFFF",
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 148,
      normalize: true,
      url: convertFileSrc(sample.masterWavPath),
    });

    const regions = ws.registerPlugin(RegionsPlugin.create());

    ws.on("ready", () => {
      const dur = ws.getDuration() || sample.durationSec;
      const initialEnd = sample.trimEndSec > 0 ? Math.min(sample.trimEndSec, dur) : dur;
      const reg = regions.addRegion({
        start: sample.trimStartSec,
        end: initialEnd,
        color: "rgba(242, 139, 118, 0.18)",
        drag: true,
        resize: true,
      });
      regionRef.current = reg;
      setTrimStart(reg.start);
      setTrimEnd(reg.end);

      reg.on("update", () => {
        setTrimStart(reg.start);
        setTrimEnd(reg.end);
        setJustTrimmed(false);
      });
    });

    ws.on("timeupdate", (currentTime) => {
      const reg = regionRef.current;
      if (!reg) return;
      if (currentTime >= reg.end) {
        if (loopRef.current) {
          ws.setTime(reg.start);
        } else {
          ws.pause();
        }
      }
    });

    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));

    wsRef.current = ws;

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [sample.masterWavPath, sample.durationSec, sample.trimStartSec, sample.trimEndSec]);

  // Spacebar audition shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        handlePlayPause();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const handlePlayPause = () => {
    const ws = wsRef.current;
    const reg = regionRef.current;
    if (!ws) return;

    if (ws.isPlaying()) {
      ws.pause();
    } else {
      if (reg && (ws.getCurrentTime() < reg.start || ws.getCurrentTime() >= reg.end)) {
        ws.setTime(reg.start);
      }
      ws.play();
    }
  };

  const handleZoomChange = (val: number) => {
    setZoom(val);
    wsRef.current?.zoom(val);
  };

  const handleTrimAndExport = async () => {
    setIsRendering(true);
    try {
      const newPath = await invoke<string>("export_trimmed_sample", {
        masterWavPath: sample.masterWavPath,
        title: sample.title,
        mode,
        startSec: trimStart,
        endSec: trimEnd,
        format: exportFormat,
      });

      onUpdateSample({
        ...sample,
        exportedPath: newPath,
        trimStartSec: trimStart,
        trimEndSec: trimEnd,
        format: exportFormat,
      });
      setJustTrimmed(true);
    } catch (err) {
      console.error("Trim export failed:", err);
    } finally {
      setIsRendering(false);
    }
  };

  const handleNativeDragStart = async () => {
    if (!sample.exportedPath) return;
    try {
      await startDrag({
        item: [sample.exportedPath],
        icon: dragIconPath || sample.exportedPath,
      });
    } catch (err) {
      console.error("Native OS drag failed:", err);
    }
  };

  const selectionLen = Math.max(0, trimEnd - trimStart);

  return (
    <div className="w-full max-w-5xl bg-[#1B1F2B] border border-[#343B50] rounded-2xl p-6 shadow-2xl flex flex-col gap-5">
      {/* Header Row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBackToCards}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#252A3A] hover:bg-[#30364B] text-xs text-slate-200 transition cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Cards</span>
          </button>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white truncate">{sample.title}</h2>
            <p className="text-xs text-slate-400 truncate">{sample.exportedPath}</p>
          </div>
        </div>

        {/* Live Trim Readout Pills */}
        <div className="flex items-center gap-2 font-mono-tech text-xs shrink-0">
          <span className="px-2.5 py-1 rounded bg-[#141720] border border-[#2E3344] text-slate-300">
            IN: <strong className="text-white">{formatTimeMs(trimStart)}</strong>
          </span>
          <span className="px-2.5 py-1 rounded bg-[#141720] border border-[#2E3344] text-slate-300">
            OUT: <strong className="text-white">{formatTimeMs(trimEnd)}</strong>
          </span>
          <span className="px-2.5 py-1 rounded bg-[#141720] border border-[#F28B76]/50 text-[#F28B76] font-semibold">
            LEN: {formatTimeMs(selectionLen)}
          </span>
        </div>
      </div>

      {/* Waveform Display Bay */}
      <div className="relative bg-[#13161F] border border-[#2B3042] rounded-xl px-4 py-3">
        <div ref={containerRef} className="w-full" />
      </div>

      {/* Bottom Transport, Trim & Native DAW Drag Pad */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Left: Transport + Loop + Zoom */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={handlePlayPause}
            className="w-10 h-10 rounded-full bg-[#F28B76] text-[#161922] flex items-center justify-center hover:opacity-90 transition cursor-pointer"
            title="Play / Pause Selection (Space)"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>

          <button
            onClick={() => setLoopRegion((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border transition cursor-pointer ${
              loopRegion
                ? "bg-[#262B3B] border-[#D6A4E0]/70 text-[#D6A4E0] font-semibold"
                : "bg-[#141720] border-[#2E3344] text-slate-400"
            }`}
          >
            <Repeat className="w-3.5 h-3.5" />
            <span>Loop</span>
          </button>

          <div className="flex items-center gap-2 bg-[#141720] border border-[#2E3344] rounded-lg px-3 py-2">
            <ZoomIn className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="range"
              min={0}
              max={150}
              value={zoom}
              onChange={(e) => handleZoomChange(Number(e.target.value))}
              className="w-24 accent-[#F28B76] cursor-pointer"
            />
          </div>
        </div>

        {/* Right: Trim Export + Reveal + Native DAW Drag Pad */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleTrimAndExport}
            disabled={isRendering}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#272C3D] hover:bg-[#32394F] border border-[#3C445C] text-xs font-semibold text-white transition cursor-pointer disabled:opacity-50"
          >
            {justTrimmed ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Scissors className="w-3.5 h-3.5 text-[#F28B76]" />
            )}
            <span>
              {isRendering
                ? "RENDERING..."
                : justTrimmed
                ? "SAVED TO MY SAMPLES"
                : `TRIM & EXPORT (${exportFormat.toUpperCase()})`}
            </span>
          </button>

          <button
            onClick={() => revealItemInDir(sample.exportedPath)}
            title="Show File in Explorer"
            className="p-2.5 rounded-xl bg-[#232736] hover:bg-[#2E3447] border border-[#343A4E] text-slate-300 hover:text-white transition cursor-pointer"
          >
            <FolderOpen className="w-4 h-4" />
          </button>

          {/* Native OS Drag-and-Drop Grip Pad */}
          <div
            onMouseDown={handleNativeDragStart}
            title="Drag directly into Ableton, FL Studio, Logic, or Explorer"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#F28B76] to-[#D6A4E0] text-[#161922] font-bold text-xs tracking-wider shadow-[0_0_20px_rgba(242,139,118,0.3)] hover:brightness-105 active:scale-95 transition cursor-grab active:cursor-grabbing"
          >
            <GripVertical className="w-4 h-4" />
            <span>DRAG TO DAW</span>
          </div>
        </div>
      </div>
    </div>
  );
}