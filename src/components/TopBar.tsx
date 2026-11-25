import { Disc3, FolderOpen, Settings } from "lucide-react";

export type WindowSizePreset = "small" | "medium" | "big";

interface TopBarProps {
  queryUsed: string;
  queryTag: string;
  savedCount: number;
  settingsOpen: boolean;
  onOpenSamplesFolder: () => void;
  onOpenSettings: () => void;
}

export function TopBar({
  queryUsed,
  queryTag,
  savedCount,
  settingsOpen,
  onOpenSamplesFolder,
  onOpenSettings,
}: TopBarProps) {
  return (
    <header className="relative z-20 h-11 px-4 flex items-center justify-between border-b border-[#c9a36b]/20 bg-gradient-to-b from-[#1f1813]/90 to-[#1f1813]/45 backdrop-blur-[2px] shrink-0 pointer-events-none">
      {/* Left: Brand & Recessed LCD Readout */}
      <div className="flex items-center gap-3 pointer-events-auto">
       <div className="flex items-center gap-2.5 select-none">
  <span className="font-bold tracking-[0.22em] text-lg text-[#eae5dc] select-none">
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

      {/* Right: 3D My Samples & Settings / Return-to-Turntable Switch */}
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
          title={settingsOpen ? "Return to Turntable View" : "Front-Panel VFD Settings"}
          className="hw-key p-1.5 cursor-pointer"
        >
          {settingsOpen ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="w-3.5 h-3.5 text-[#262420]"
            >
              <circle cx="12" cy="12" r="9.5" />
              <circle cx="12" cy="12" r="6.2" strokeOpacity="0.45" strokeDasharray="3 2" />
              <circle cx="12" cy="12" r="3.2" />
              <circle cx="12" cy="12" r="1" fill="currentColor" />
            </svg>
          ) : (
            <Settings className="w-3.5 h-3.5 text-[#262420]" />
          )}
        </button>
      </div>
    </header>
  );
}