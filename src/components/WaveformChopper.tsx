import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/dist/plugins/regions.esm.js";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { Play, Pause, Scissors, GripVertical, ArrowLeft, Check } from "lucide-react";
import { VuMeter } from "./VuMeter";
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionRef = useRef<Region | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(() =>
    Math.min(sample.durationSec || 16, 16)
  );
  const [isExporting, setIsExporting] = useState(false);
  const [exportSavedToast, setExportSavedToast] = useState(false);
  const [vuLeft, setVuLeft] = useState(0);
  const [vuRight, setVuRight] = useState(0);
  const [dragFilePath, setDragFilePath] = useState(sample.masterWavPath);

  useEffect(() => {
    setDragFilePath(sample.masterWavPath);
  }, [sample.masterWavPath]);

  useEffect(() => {
    if (!containerRef.current) return;

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
      url: convertFileSrc(sample.masterWavPath),
      plugins: [regions],
    });

    ws.on("ready", () => {
      const dur = ws.getDuration();
      const initialEnd = Math.min(dur, 16);
      setStartSec(0);
      setEndSec(initialEnd);

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
      });

      regionRef.current = reg;
    });

    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));
    ws.on("finish", () => setIsPlaying(false));

    ws.on("audioprocess", (time) => {
      const reg = regionRef.current;
      if (reg && time >= reg.end) {
        ws.setTime(reg.start);
      }
      const pulse = 0.48 + Math.sin(time * 19) * 0.22 + Math.cos(time * 31) * 0.16;
      setVuLeft(Math.max(0.15, Math.min(0.95, pulse)));
      setVuRight(Math.max(0.15, Math.min(0.95, pulse * 0.94 + 0.06)));
    });

    wsRef.current = ws;

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [sample.masterWavPath]);

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

  const handleTrimAndExport = async () => {
    setIsExporting(true);
    try {
      const res = await invoke<unknown>("export_trimmed_sample", {
        sample,
        startSec,
        endSec,
        format: exportFormat,
      });

      if (typeof res === "string") {
        setDragFilePath(res);
      } else if (res && typeof res === "object") {
        const obj = res as Record<string, unknown>;
        const nextPath =
          (typeof obj.exportedPath === "string" && obj.exportedPath) ||
          (typeof obj.trimmedPath === "string" && obj.trimmedPath) ||
          (typeof obj.outputPath === "string" && obj.outputPath) ||
          (typeof obj.masterWavPath === "string" && obj.masterWavPath);

        if (nextPath) setDragFilePath(nextPath);
        if (typeof obj.masterWavPath === "string") {
          onUpdateSample(res as ActiveSample);
        }
      }

      setExportSavedToast(true);
      setTimeout(() => setExportSavedToast(false), 2200);
    } catch (err) {
      console.error("Trim failed:", err);
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
            onClick={onClose}
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
            className="hw-key hw-key-lit-amber px-5 py-2.5 flex items-center gap-2 font-chassis text-sm font-extrabold tracking-widest uppercase cursor-pointer disabled:opacity-50"
          >
            {exportSavedToast ? <Check className="w-4 h-4" /> : <Scissors className="w-4 h-4" />}
            <span>
              {isExporting
                ? "PRINTING..."
                : exportSavedToast
                ? "SAVED TO MY SAMPLES"
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