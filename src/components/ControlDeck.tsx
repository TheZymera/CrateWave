import { Dice5, Lock } from "lucide-react";
import { useCrateStore } from "../store/useCrateStore";
import type { DigMode } from "../types/crate";

interface ControlDeckProps {
  onRoll: () => void;
}

const MODES: { id: DigMode; label: string; sub: string }[] = [
  { id: "general", label: "General", sub: "Full matrix" },
  { id: "world_adventure", label: "World Adventure", sub: "Global + Era" },
  { id: "only_vocal", label: "Only Vocal", sub: "Acapella / Shorts" },
  { id: "only_instrumental", label: "Only Instrumental", sub: "No vocals" },
];

const DECADES = ["all", "1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"];
const REGIONS = [
  { id: "all", label: "Global" },
  { id: "japan", label: "Japan" },
  { id: "brazil", label: "Brazil" },
  { id: "cis", label: "CIS / Russia" },
  { id: "europe", label: "Europe" },
  { id: "mena", label: "Middle East" },
  { id: "africa", label: "Africa" },
  { id: "latin", label: "Latin" },
  { id: "usa_uk", label: "USA / UK" },
];
const GENRES = [
  { id: "all", label: "Any Genre" },
  { id: "jazz", label: "Jazz" },
  { id: "funk", label: "Funk / Soul" },
  { id: "ambient", label: "Ambient" },
  { id: "synth", label: "Synth" },
  { id: "classical", label: "Classical" },
  { id: "folk", label: "Folk / Ethnic" },
  { id: "psych", label: "Psych Rock" },
  { id: "electronic", label: "Electronic" },
];

export function ControlDeck({ onRoll }: ControlDeckProps) {
  const { filters, isRolling, setMode, updateFilter } = useCrateStore();
  const mode = filters.mode;

  const isWorld = mode === "world_adventure";
  const isVocal = mode === "only_vocal";
  const isVocalShorts = isVocal && filters.duration === "shorts";
  const isInst = mode === "only_instrumental";

  return (
    <footer className="h-[196px] bg-[#1D202B] border-t border-[#2E3344] grid grid-cols-12 shrink-0">
      {/* Column 1: Mode Selector (3 cols) */}
      <div className="col-span-3 border-r border-[#2E3344] p-3.5 flex flex-col justify-between">
        <span className="text-[10px] font-mono-tech uppercase tracking-widest text-slate-400">
          Digging Mode
        </span>
        <div className="grid grid-cols-1 gap-1.5">
          {MODES.map((m) => {
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-xs transition cursor-pointer border ${
                  active
                    ? "bg-[#262B3B] border-[#F28B76]/60 text-white font-medium"
                    : "bg-[#171A23] border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${active ? "led-coral" : "bg-slate-600"}`} />
                  <span>{m.label}</span>
                </div>
                <span className="text-[10px] font-mono-tech text-slate-500">{m.sub}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Column 2 & 3: Dynamic Parameter Matrix (6 cols) */}
      <div className="col-span-6 border-r border-[#2E3344] p-3.5 flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono-tech uppercase tracking-widest text-slate-400">
            Filter Matrix
          </span>
          {isWorld && (
            <span className="flex items-center gap-1 text-[10px] font-mono-tech text-[#F28B76]">
              <Lock className="w-3 h-3" /> World Mode locks Type, Region & Length
            </span>
          )}
        </div>

        {/* Row 1: Decade Selector (Hidden/locked in Vocal Shorts mode) */}
        <div className={`flex flex-col gap-1 transition-opacity ${isVocalShorts ? "opacity-30 pointer-events-none" : ""}`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono-tech text-slate-400">DECADE</span>
            {isVocalShorts && (
              <span className="text-[10px] font-mono-tech text-[#F28B76]">
                Disabled for Shorts (YT Only)
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {DECADES.map((dec) => {
              const active = filters.decade === dec;
              return (
                <button
                  key={dec}
                  onClick={() => updateFilter("decade", dec)}
                  className={`px-2 py-1 rounded text-[11px] font-mono-tech transition cursor-pointer ${
                    active
                      ? "bg-[#F28B76] text-[#161922] font-bold"
                      : "bg-[#161922] text-slate-400 hover:text-white border border-[#2E3344]"
                  }`}
                >
                  {dec === "all" ? "ALL" : dec}
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 2: Mode-Specific Secondary Controls */}
        {isInst ? (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-mono-tech text-slate-400">INSTRUMENTAL GENRE</span>
            <div className="flex flex-wrap gap-1">
              {GENRES.map((g) => {
                const active = filters.genre === g.id;
                return (
                  <button
                    key={g.id}
                    onClick={() => updateFilter("genre", g.id)}
                    className={`px-2 py-1 rounded text-[11px] transition cursor-pointer ${
                      active
                        ? "bg-[#D6A4E0] text-[#161922] font-bold"
                        : "bg-[#161922] text-slate-400 hover:text-white border border-[#2E3344]"
                    }`}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : isVocal ? (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-mono-tech text-slate-400">VOCAL FORMAT</span>
            <div className="flex gap-2">
              {[
                { id: "shorts", label: "Shorts (< 60s / 'Sample This')" },
                { id: "any", label: "Full Acapellas & Stems" },
              ].map((opt) => {
                const active = (filters.duration === "shorts" ? "shorts" : "any") === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => updateFilter("duration", opt.id as "shorts" | "any")}
                    className={`px-3 py-1.5 rounded text-xs transition cursor-pointer ${
                      active
                        ? "bg-[#D6A4E0] text-[#161922] font-semibold"
                        : "bg-[#161922] text-slate-400 hover:text-white border border-[#2E3344]"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className={`grid grid-cols-2 gap-3 transition-opacity ${isWorld ? "opacity-35 pointer-events-none" : ""}`}>
            {/* Region */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-mono-tech text-slate-400">REGION</span>
              <select
                value={filters.region}
                onChange={(e) => updateFilter("region", e.target.value)}
                className="bg-[#161922] border border-[#2E3344] rounded px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-[#F28B76]"
              >
                {REGIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Type & Duration */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-mono-tech text-slate-400">TYPE</span>
                <select
                  value={filters.sampleType}
                  onChange={(e) =>
                    updateFilter("sampleType", e.target.value as "all" | "track" | "vocal" | "instrumental")
                  }
                  className="bg-[#161922] border border-[#2E3344] rounded px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-[#F28B76]"
                >
                  <option value="all">All</option>
                  <option value="track">Track</option>
                  <option value="vocal">Vocal</option>
                  <option value="instrumental">Inst</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-mono-tech text-slate-400">LENGTH</span>
                <select
                  value={filters.duration}
                  onChange={(e) =>
                    updateFilter("duration", e.target.value as "any" | "shorts" | "medium" | "long")
                  }
                  className="bg-[#161922] border border-[#2E3344] rounded px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-[#F28B76]"
                >
                  <option value="any">Any</option>
                  <option value="shorts">&lt; 1m</option>
                  <option value="medium">1–5m</option>
                  <option value="long">5m+</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Column 4: Master ROLL CRATE Focal Control (3 cols) */}
      <div className="col-span-3 p-3.5 flex flex-col items-center justify-between">
        <div className="w-full flex items-center justify-between">
          <span className="text-[10px] font-mono-tech uppercase tracking-widest text-slate-400">
            Trigger
          </span>
          <div className="flex items-center gap-1 font-mono-tech text-[10px]">
            {([2, 3, 4] as const).map((n) => (
              <button
                key={n}
                onClick={() => updateFilter("cardCount", n)}
                className={`px-1.5 py-0.5 rounded cursor-pointer ${
                  filters.cardCount === n
                    ? "bg-[#2A2F40] text-[#F28B76] font-bold"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {n}x
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={onRoll}
          disabled={isRolling}
          className="w-24 h-24 rounded-full bg-[#161922] border-2 border-[#9C88D9]/60 hover:border-[#F28B76] active:scale-95 disabled:opacity-50 flex flex-col items-center justify-center gap-1 shadow-[0_0_24px_rgba(156,136,217,0.2)] hover:shadow-[0_0_28px_rgba(242,139,118,0.35)] transition cursor-pointer"
        >
          <Dice5 className={`w-6 h-6 text-[#F28B76] ${isRolling ? "animate-spin" : ""}`} />
          <span className="text-[11px] font-bold tracking-wider text-white">
            {isRolling ? "ROLLING" : "ROLL CRATE"}
          </span>
        </button>

        <span className="text-[10px] font-mono-tech text-slate-500">
          {filters.cardCount} CARDS • MULTI-SOURCE
        </span>
      </div>
    </footer>
  );
}