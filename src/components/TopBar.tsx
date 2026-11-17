import { FolderOpen, Settings } from "lucide-react";

export type WindowSizePreset = "small" | "medium" | "big";

interface TopBarProps {
  queryUsed: string;
  queryTag: string;
  savedCount: number;
  onOpenSamplesFolder: () => void;
  onOpenSettings: () => void;
}

export function TopBar({
  queryUsed,
  queryTag,
  savedCount,
  onOpenSamplesFolder,
  onOpenSettings,
}: TopBarProps) {
  return (
    <header className="relative z-20 h-11 px-4 flex items-center justify-between border-b border-[#c9a36b]/20 bg-gradient-to-b from-[#1f1813]/90 to-[#1f1813]/45 backdrop-blur-[2px] shrink-0 pointer-events-none">
      {/* Left: Brand & Recessed LCD Readout */}
      <div className="flex items-center gap-3 pointer-events-auto">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#ffb347] shadow-[0_0_8px_#ffb347]" />
          <span className="font-chassis font-extrabold text-sm tracking-[0.24em] text-[#f0e2c8]">
            CRATEWAVE
          </span>
        </div>

        <div className="recessed-lcd rounded px-3 py-1 flex items-center gap-2.5 max-w-[300px]">
          <span className="font-mono-tech text-[11px] text-[#ffcf70] truncate drop-shadow-[0_0_6px_rgba(255,185,70,0.45)]">
            {queryUsed || "CLICK VINYL CENTER TO DIG"}
          </span>
          {queryTag && (
            <span className="font-mono-tech text-[9px] uppercase px-1.5 py-0.2 rounded bg-[#2a2114] text-[#ffb347] border border-[#59411e] shrink-0">
              {queryTag}
            </span>
          )}
        </div>
      </div>

      {/* Right: 3D My Samples & Settings Switches */}
      <div className="flex items-center gap-2.5 pointer-events-auto">
        <button
          onClick={onOpenSamplesFolder}
          title="Open My Samples Folder"
          className="hw-key px-2.5 py-1 flex items-center gap-1.5 font-chassis text-xs font-bold tracking-wider uppercase cursor-pointer"
        >
          <FolderOpen className="w-3.5 h-3.5 text-[#5c3d16]" />
          <span>SAMPLES</span>
          <span className="font-mono-tech text-[10px] bg-[#262420] text-[#ffd27d] px-1.5 rounded">
            {savedCount}
          </span>
        </button>

        <button
          onClick={onOpenSettings}
          title="Settings & Search Word Bubbles"
          className="hw-key p-1.5 cursor-pointer"
        >
          <Settings className="w-3.5 h-3.5 text-[#262420]" />
        </button>
      </div>
    </header>
  );
}