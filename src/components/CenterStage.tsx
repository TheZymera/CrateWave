import { useState } from "react";
import { Disc3, Play, Square, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { WaveformChopper } from "./WaveformChopper";
import type {
  ActiveSample,
  ChopJobProgress,
  DigMode,
  ExportFormat,
  SampleCandidate,
} from "../types/crate";

interface CenterStageProps {
  candidates: SampleCandidate[];
  isRolling: boolean;
  errorMsg: string | null;
  activeJob: ChopJobProgress | null;
  activeSample: ActiveSample | null;
  loadingCardId: string | null;
  mode: DigMode;
  exportFormat: ExportFormat;
  onLoadAndChop: (candidate: SampleCandidate) => void;
  onUpdateSample: (updated: ActiveSample) => void;
  onClearActiveSample: () => void;
}

export function CenterStage({
  candidates,
  isRolling,
  errorMsg,
  activeJob,
  activeSample,
  loadingCardId,
  mode,
  exportFormat,
  onLoadAndChop,
  onUpdateSample,
  onClearActiveSample,
}: CenterStageProps) {
  const [previewId, setPreviewId] = useState<string | null>(null);

  const togglePreview = (c: SampleCandidate) => {
    if (c.source === "youtube") {
      setPreviewId((prev) => (prev === c.id ? null : c.id));
    } else {
      openUrl(c.sourceUrl).catch(console.error);
    }
  };

  return (
    <section className="relative flex-1 flex items-center justify-center px-10 overflow-hidden">
      {/* Bismuth Glowing Horizon Line */}
      <div
        className={`absolute inset-x-0 top-1/2 -translate-y-1/2 h-[1px] horizon-line pointer-events-none transition-opacity duration-300 ${
          isRolling || loadingCardId ? "opacity-100 animate-pulse" : "opacity-80"
        }`}
      />

      <div className="relative z-10 w-full max-w-6xl flex flex-col items-center justify-center">
        {errorMsg && (
          <div className="mb-5 px-4 py-2 rounded-full bg-red-950/90 border border-red-500/50 text-xs text-red-200 font-mono-tech">
            {errorMsg}
          </div>
        )}

        {activeSample ? (
          <WaveformChopper
            sample={activeSample}
            mode={mode}
            exportFormat={exportFormat}
            onUpdateSample={onUpdateSample}
            onBackToCards={onClearActiveSample}
          />
        ) : candidates.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-3">
            <div className="w-20 h-20 rounded-full bg-[#1D202B]/90 border border-[#32384B] flex items-center justify-center shadow-[0_0_30px_rgba(156,136,217,0.25)]">
              <Disc3
                className={`w-9 h-9 text-[#D6A4E0] ${isRolling ? "animate-spin" : ""}`}
              />
            </div>
            <p className="text-sm text-slate-300 tracking-wide">
              {isRolling
                ? "Digging global archives & crates..."
                : "Select a digging mode below and hit ROLL CRATE"}
            </p>
          </div>
        ) : (
          <div
            className={`grid gap-6 w-full ${
              candidates.length === 2
                ? "grid-cols-2 max-w-3xl"
                : candidates.length === 4
                ? "grid-cols-4"
                : "grid-cols-3"
            }`}
          >
            {candidates.map((c) => {
              const isCardLoading = loadingCardId === c.id;
              const pct = isCardLoading && activeJob ? Math.round(activeJob.percent) : 0;
              const isPreviewing = previewId === c.id;

              return (
                <div
                  key={c.id}
                  className="bg-[#1B1F2B] border border-[#32384C] hover:border-[#49516E] rounded-2xl overflow-hidden flex flex-col justify-between shadow-2xl transition"
                >
                  <div className="relative h-40 bg-[#12151E] overflow-hidden group">
                    {isPreviewing && c.source === "youtube" ? (
                      <iframe
                        className="w-full h-full border-0"
                        src={`https://www.youtube.com/embed/${c.id}?autoplay=1`}
                        title={c.title}
                        allow="autoplay; encrypted-media"
                      />
                    ) : c.thumbnailUrl ? (
                      <img
                        src={c.thumbnailUrl}
                        alt={c.title}
                        className="w-full h-full object-cover opacity-85 group-hover:opacity-100 group-hover:scale-105 transition duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#23283A] to-[#141720]">
                        <Disc3 className="w-12 h-12 text-[#9C88D9]/50" />
                      </div>
                    )}

                    <div className="absolute top-2.5 inset-x-2.5 flex items-center justify-between pointer-events-none">
                      <span className="px-2.5 py-0.5 rounded-full bg-[#141720]/90 border border-[#2E3344] text-[10px] font-semibold text-[#D6A4E0] uppercase">
                        {c.source.replace("_", " ")}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-[#141720]/90 border border-[#2E3344] text-[11px] font-mono-tech text-slate-200">
                        {c.durationSec > 0
                          ? `${Math.floor(c.durationSec / 60)}:${String(
                              c.durationSec % 60
                            ).padStart(2, "0")}`
                          : "--:--"}
                      </span>
                    </div>

                    {!isCardLoading && (
                      <button
                        onClick={() => togglePreview(c)}
                        title={c.source === "youtube" ? "Quick Preview" : "Open Source Page"}
                        className="absolute bottom-2.5 right-2.5 w-8 h-8 rounded-full bg-[#141720]/90 hover:bg-[#F28B76] text-white hover:text-[#161922] border border-[#2E3344] flex items-center justify-center transition cursor-pointer"
                      >
                        {isPreviewing ? (
                          <Square className="w-3.5 h-3.5 fill-current" />
                        ) : c.source === "youtube" ? (
                          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                        ) : (
                          <ExternalLink className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}

                    {isCardLoading && (
                      <div className="absolute inset-0 bg-[#141720]/90 backdrop-blur-xs flex flex-col items-center justify-center gap-2">
                        <div className="relative w-14 h-14 flex items-center justify-center">
                          <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
                            <circle
                              cx="28"
                              cy="28"
                              r="23"
                              fill="none"
                              stroke="#2E3344"
                              strokeWidth="4"
                            />
                            <circle
                              cx="28"
                              cy="28"
                              r="23"
                              fill="none"
                              stroke="#F28B76"
                              strokeWidth="4"
                              strokeDasharray={144.5}
                              strokeDashoffset={144.5 - (144.5 * pct) / 100}
                              strokeLinecap="round"
                            />
                          </svg>
                          <span className="absolute text-xs font-mono-tech font-bold text-white">
                            {pct}%
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-300 px-3 text-center truncate max-w-full">
                          {activeJob?.message || "Starting download..."}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="p-4 flex flex-col justify-between flex-1">
                    <div>
                      <h3 className="text-sm font-semibold text-white line-clamp-2 leading-snug mb-1">
                        {c.title}
                      </h3>
                      <p className="text-xs text-slate-400 truncate">{c.channel}</p>
                    </div>

                    <button
                      onClick={() => onLoadAndChop(c)}
                      disabled={Boolean(loadingCardId)}
                      className="mt-4 w-full py-2 rounded-xl bg-[#272C3D] hover:bg-[#F28B76] disabled:opacity-40 text-slate-100 hover:text-[#161922] text-xs font-bold tracking-wider transition cursor-pointer"
                    >
                      {isCardLoading ? "PROCESSING..." : "LOAD & CHOP"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}