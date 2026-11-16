import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Plus, Monitor, Sparkles, RefreshCw, Check } from "lucide-react";
import type { WindowSizePreset } from "./TopBar";

interface QueryDictionary {
  generalQueries: string[];
  crateModifiers: string[];
  vocalShortsQueries: string[];
  vocalFullQueries: string[];
  genreKeywords: Record<string, string[]>;
  regionQueries: Record<string, string[]>;
}

interface SettingsModalProps {
  isOpen: boolean;
  windowPreset: WindowSizePreset;
  onChangeWindowPreset: (preset: WindowSizePreset) => void;
  onClose: () => void;
}

const SIZE_OPTIONS: { id: WindowSizePreset; label: string; dims: string }[] = [
  { id: "small", label: "Small", dims: "1470 × 770" },
  { id: "medium", label: "Medium", dims: "1650 × 930" },
  { id: "big", label: "Big", dims: "2000 × 1200" },
];

type BubbleSectionKey = "generalQueries" | "crateModifiers" | "vocalFullQueries";

const SECTIONS: { key: BubbleSectionKey; label: string }[] = [
  { key: "generalQueries", label: "General Digging Terms" },
  { key: "crateModifiers", label: "Crate Modifiers" },
  { key: "vocalFullQueries", label: "Vocal / Acapella Terms" },
];

export function SettingsModal({
  isOpen,
  windowPreset,
  onChangeWindowPreset,
  onClose,
}: SettingsModalProps) {
  const [dict, setDict] = useState<QueryDictionary | null>(null);
  const [addingSection, setAddingSection] = useState<BubbleSectionKey | null>(null);
  const [newWord, setNewWord] = useState("");
  const [updatingYtDlp, setUpdatingYtDlp] = useState(false);
  const [ytDlpStatus, setYtDlpStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    invoke<QueryDictionary>("get_query_dictionary")
      .then(setDict)
      .catch(console.error);
  }, [isOpen]);

  if (!isOpen) return null;

  const persistDict = async (updated: QueryDictionary) => {
    setDict(updated);
    await invoke("save_query_dictionary", { dict: updated }).catch(console.error);
  };

  const handleAddWord = async (section: BubbleSectionKey) => {
    const trimmed = newWord.trim();
    if (!trimmed || !dict) {
      setAddingSection(null);
      setNewWord("");
      return;
    }
    if (!dict[section].includes(trimmed)) {
      const updated = {
        ...dict,
        [section]: [...dict[section], trimmed],
      };
      await persistDict(updated);
    }
    setNewWord("");
    setAddingSection(null);
  };

  const handleRemoveWord = async (section: BubbleSectionKey, word: string) => {
    if (!dict || dict[section].length <= 1) return;
    const updated = {
      ...dict,
      [section]: dict[section].filter((w) => w !== word),
    };
    await persistDict(updated);
  };

  const handleUpdateYtDlp = async () => {
    setUpdatingYtDlp(true);
    setYtDlpStatus(null);
    try {
      const msg = await invoke<string>("update_ytdlp_binary");
      setYtDlpStatus(msg);
    } catch (err) {
      setYtDlpStatus(String(err));
    } finally {
      setUpdatingYtDlp(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0E1017]/80 backdrop-blur-xs flex items-center justify-center p-6">
      <div className="w-full max-w-3xl bg-[#1B1F2B] border border-[#343B50] rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#2E3344] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full led-coral" />
            <h2 className="text-sm font-semibold tracking-wider text-white uppercase">
              CrateWave Settings & Search Pool
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-[#252A3A] hover:bg-[#32384D] text-slate-300 hover:text-white transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 overflow-y-auto flex flex-col gap-6">
          {/* Window Size Presets */}
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2.5">
              <Monitor className="w-3.5 h-3.5 text-[#D6A4E0]" />
              <span>Window Dimensions</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {SIZE_OPTIONS.map((opt) => {
                const active = windowPreset === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => onChangeWindowPreset(opt.id)}
                    className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs border transition cursor-pointer ${
                      active
                        ? "bg-[#262B3B] border-[#F28B76] text-white font-semibold"
                        : "bg-[#141720] border-[#2E3344] text-slate-300 hover:text-white"
                    }`}
                  >
                    <span>{opt.label}</span>
                    <span className="text-[11px] text-slate-400">{opt.dims}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Interactive Search Word Bubbles */}
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
              <Sparkles className="w-3.5 h-3.5 text-[#F28B76]" />
              <span>Randomizer Search Dictionary (Live Sync)</span>
            </div>

            {!dict ? (
              <p className="text-xs text-slate-400">Loading dictionary...</p>
            ) : (
              <div className="flex flex-col gap-4">
                {SECTIONS.map((sec) => (
                  <div
                    key={sec.key}
                    className="bg-[#141720] border border-[#2B3042] rounded-xl p-3.5"
                  >
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2.5">
                      {sec.label}
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                      {(dict[sec.key] ?? []).map((word) => (
                        <span
                          key={word}
                          className="group inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#232838] border border-[#353C52] text-xs text-slate-200"
                        >
                          <span>{word}</span>
                          <button
                            onClick={() => handleRemoveWord(sec.key, word)}
                            title="Remove term"
                            className="text-slate-500 hover:text-[#F28B76] transition cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}

                      {addingSection === sec.key ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleAddWord(sec.key);
                          }}
                          className="inline-flex items-center gap-1"
                        >
                          <input
                            autoFocus
                            value={newWord}
                            onChange={(e) => setNewWord(e.target.value)}
                            onBlur={() => handleAddWord(sec.key)}
                            placeholder="New search phrase..."
                            className="px-3 py-1 rounded-full bg-[#1B1F2B] border border-[#F28B76] text-xs text-white outline-none w-44"
                          />
                          <button
                            type="submit"
                            className="p-1 rounded-full bg-[#F28B76] text-[#161922] cursor-pointer"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                        </form>
                      ) : (
                        <button
                          onClick={() => {
                            setAddingSection(sec.key);
                            setNewWord("");
                          }}
                          title="Add new search word"
                          className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#1B1F2B] hover:bg-[#272D3F] border border-dashed border-[#F28B76]/70 text-xs text-[#F28B76] font-medium transition cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Engine Maintenance */}
          <div className="flex items-center justify-between pt-2 border-t border-[#2E3344]">
            <div className="text-xs text-slate-400">
              {ytDlpStatus || "Keep yt-dlp extractor updated for YouTube & SoundCloud"}
            </div>
            <button
              onClick={handleUpdateYtDlp}
              disabled={updatingYtDlp}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#252A3A] hover:bg-[#32384D] text-xs font-medium text-white transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${updatingYtDlp ? "animate-spin" : ""}`} />
              <span>{updatingYtDlp ? "Updating..." : "Update yt-dlp"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}