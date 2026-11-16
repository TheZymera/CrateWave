import { FolderOpen, Settings, Sparkles } from "lucide-react";
import type { ExportFormat } from "../types/crate";

export type WindowSizePreset = "small" | "medium" | "big";

interface TopBarProps {
  queryUsed: string;
  queryTag: string;
  exportFormat: ExportFormat;
  savedCount: number;
  onToggleFormat: (fmt: ExportFormat) => void;
  onOpenSamplesFolder: () => void;
  onOpenSettings: () => void;
}

export function TopBar({
  queryUsed,
  queryTag,
  exportFormat,
  savedCount,
  onToggleFormat,
  onOpenSamplesFolder,
  onOpenSettings,
}: TopBarProps) {
  return (
    <header className="relative h-12 px-5 flex items-center justify-between border-b border-[#2E3344]/80 bg-[#191C26]/90 backdrop-blur-sm shrink-0 z-30">
      {/* Left: Brand Wordmark & Status LED */}
      <div className="flex items-center gap-3">
        <span className="w-2 h-2 rounded-full led-coral" />
        <span className="tracking-[0.22em] text-sm font-semibold text-white">
          CRATEWAVE
        </span>
        <span className="text-[11px] font-mono-tech text-slate-400 bg-[#232736] px-2 py-0.5 rounded border border-[#2E3344]">
          v1.0
        </span>
      </div>

      {/* Center: Active Search Query Capsule */}
      <div className="flex items-center gap-2 bg-[#232736] border border-[#32384B] rounded-full px-4 py-1 max-w-md w-full justify-between">
        <div className="flex items-center gap-2 truncate">
          <Sparkles className="w-3.5 h-3.5 text-[#D6A4E0] shrink-0" />
          <span className="text-xs text-slate-200 truncate font-medium">
            {queryUsed || "Ready to dig — press ROLL CRATE"}
          </span>
        </div>
        {queryTag && (
          <span className="text-[11px] font-medium text-[#F28B76] bg-[#191C26] px-2.5 py-0.5 rounded-full shrink-0">
            {queryTag}
          </span>
        )}
      </div>

      {/* Right: Format Switcher + My Samples + Settings */}
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-[#141720] p-0.5 rounded-md border border-[#2E3344] font-mono-tech text-[11px]">
          <button
            onClick={() => onToggleFormat("wav")}
            className={`px-2.5 py-1 rounded transition cursor-pointer ${
              exportFormat === "wav"
                ? "bg-[#2A2F40] text-[#F28B76] font-semibold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            WAV
          </button>
          <button
            onClick={() => onToggleFormat("mp3_320")}
            className={`px-2.5 py-1 rounded transition cursor-pointer ${
              exportFormat === "mp3_320"
                ? "bg-[#2A2F40] text-[#F28B76] font-semibold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            MP3 320
          </button>
        </div>

        <button
          onClick={onOpenSamplesFolder}
          title="Open My Samples Folder"
          className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white bg-[#232736] hover:bg-[#2B3042] border border-[#2E3344] px-2.5 py-1.5 rounded-md transition cursor-pointer"
        >
          <FolderOpen className="w-3.5 h-3.5 text-[#D6A4E0]" />
          <span>My Samples</span>
          <span className="text-[10px] font-mono-tech text-slate-400 bg-[#141720] px-1.5 py-0.2 rounded">
            {savedCount}
          </span>
        </button>

        <button
          onClick={onOpenSettings}
          title="Settings & Search Word Bubbles"
          className="p-1.5 bg-[#232736] hover:bg-[#2B3042] border border-[#2E3344] text-slate-400 hover:text-white rounded-md transition cursor-pointer"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}