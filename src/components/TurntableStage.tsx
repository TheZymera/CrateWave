import { Disc3 } from "lucide-react";
import { Turntable3DCanvas } from "./Turntable3DCanvas";
import { useCrateStore } from "../store/useCrateStore";
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
  onChangeVolume: (val: number) => void;
  onToggleFormat: (fmt: ExportFormat) => void;
  onRerollCenter: () => void;
  onPlay: () => void;
  onStop: () => void;
  onOpenTrim: () => void;
}

export function TurntableStage({
  currentCandidate,
  activeSample,
  isPlaying,
  isLoadingTrack,
  loadingMessage,
  errorMsg,
  vuLevel,
  masterVolume,
  exportFormat,
  onChangeVolume,
  onToggleFormat,
  onRerollCenter,
  onPlay,
  onStop,
  onOpenTrim,
}: TurntableStageProps) {
  const { filters } = useCrateStore();

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
          title={trackTitle}
          subtitle={trackSub}
          activeMode={filters.mode}
          isPlaying={isPlaying}
          isLoading={isLoadingTrack}
          hasActiveSample={Boolean(activeSample)}
          vuLevel={vuLevel}
          masterVolume={masterVolume}
          onSelectMode={(mode: DigMode) => updateFilter("mode", mode)}
          onClickCenterLabel={onRerollCenter}
          onPlay={onPlay}
          onStop={onStop}
          onOpenTrim={onOpenTrim}
          onChangeVolume={onChangeVolume}
        />
      </div>

      {/* Floating Error Banner */}
      {errorMsg && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 max-w-md px-3.5 py-1.5 rounded-md bg-[#2d1014]/95 border border-rose-500/60 text-rose-200 font-mono-tech text-[11px] shadow-xl text-center pointer-events-auto">
          {errorMsg}
        </div>
      )}

      {/* Floating Digging Status Pill */}
      {isLoadingTrack && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1 rounded-full bg-[#1c1612]/95 border border-[#ffb347]/75 text-[#ffd27d] font-mono-tech text-[10px] shadow-2xl flex items-center gap-1.5">
          <Disc3 className="w-3.5 h-3.5 animate-spin text-[#ffb347]" />
          <span>{loadingMessage || "DIGGING CRATE..."}</span>
        </div>
      )}

      {/* Bottom-Right Recessed Warm-Metal Filter Control Plate */}
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
          <label className="flex flex-col gap-0.5">
            <span className="font-chassis text-[9px] font-bold uppercase text-[#b5a48b]">
              TYPE
            </span>
            <select
              value={filters.sampleType}
              onChange={(e) =>
                updateFilter("sampleType", e.target.value as typeof filters.sampleType)
              }
              className="bg-[#14110e] border border-[#3d3328] rounded px-1.5 py-1 text-[#f2eadc] font-chassis text-xs outline-none focus:border-[#ffb347]"
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

          <label className="flex flex-col gap-0.5">
            <span className="font-chassis text-[9px] font-bold uppercase text-[#b5a48b]">
              LENGTH
            </span>
            <select
              value={filters.duration}
              onChange={(e) =>
                updateFilter("duration", e.target.value as typeof filters.duration)
              }
              className="bg-[#14110e] border border-[#3d3328] rounded px-1.5 py-1 text-[#f2eadc] font-chassis text-xs outline-none focus:border-[#ffb347]"
            >
              <option value="all">Any Length</option>
              <option value="shorts">Shorts (&lt;60s)</option>
              <option value="short">Short (1–3m)</option>
              <option value="medium">Medium (3–8m)</option>
              <option value="long">Long (8m+)</option>
            </select>
          </label>

          <label className="col-span-2 flex flex-col gap-0.5">
            <span className="font-chassis text-[9px] font-bold uppercase text-[#b5a48b]">
              GENRE
            </span>
            <select
              value={filters.genre}
              onChange={(e) =>
                updateFilter("genre", e.target.value as typeof filters.genre)
              }
              className="bg-[#14110e] border border-[#3d3328] rounded px-1.5 py-1 text-[#f2eadc] font-chassis text-xs outline-none focus:border-[#ffb347]"
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
    </main>
  );
}