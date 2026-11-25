import { invoke } from "@tauri-apps/api/core";

export type LogLevel = "INFO" | "WARN" | "ERROR";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  category: string;
  message: string;
  meta?: string;
}

const recentEntries: LogEntry[] = [];
let initialized = false;
let onProblemCallback: ((entry: LogEntry) => void) | null = null;

function sendToRust(
  level: LogLevel,
  category: string,
  message: string,
  meta?: Record<string, unknown> | string
) {
  const metaStr =
    typeof meta === "string"
      ? meta
      : meta
      ? JSON.stringify(meta)
      : undefined;

  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    category,
    message,
    meta: metaStr,
  };

  recentEntries.push(entry);
  if (recentEntries.length > 200) recentEntries.shift();

  if ((level === "ERROR" || level === "WARN") && onProblemCallback) {
    onProblemCallback(entry);
  }

  invoke("log_event", {
    level,
    source: "UI",
    category,
    message,
    meta: metaStr ?? null,
  }).catch(() => {});
}

export const logInfo = (category: string, message: string, meta?: Record<string, unknown> | string) =>
  sendToRust("INFO", category, message, meta);

export const logWarn = (category: string, message: string, meta?: Record<string, unknown> | string) =>
  sendToRust("WARN", category, message, meta);

export const logError = (category: string, message: string, meta?: Record<string, unknown> | string) =>
  sendToRust("ERROR", category, message, meta);

/** User interactions: digging, play/stop, mode change, trim export, DAW drag */
export const logActivity = (action: string, details?: Record<string, unknown> | string) =>
  sendToRust("INFO", `ACT:${action}`, action, details);

/** Background/internal work: WebAudio decode, buffer swap, extend_sample_audio */
export const logTask = (task: string, status: string, details?: Record<string, unknown> | string) =>
  sendToRust("INFO", `TASK:${task}`, status, details);

export function onLogProblem(cb: ((entry: LogEntry) => void) | null) {
  onProblemCallback = cb;
}

export function getRecentSessionSummary() {
  const warnings = recentEntries.filter((e) => e.level === "WARN").length;
  const errors = recentEntries.filter((e) => e.level === "ERROR").length;
  return { warnings, errors, recentEntries: [...recentEntries] };
}

export function initFrontendLogger() {
  if (initialized) return;
  initialized = true;

  logInfo("ENV", "Frontend initialized", {
    navigatorOnline: navigator.onLine,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    dpr: window.devicePixelRatio,
  });

  // Verify real TCP internet reachability via Rust
  invoke<boolean>("check_network_status").catch(() => {});

  // Track live Wi-Fi / Ethernet drops
  window.addEventListener("online", () => {
    logInfo("NETWORK", "Browser reported ONLINE");
    invoke<boolean>("check_network_status").catch(() => {});
  });
  window.addEventListener("offline", () => {
    logWarn("NETWORK", "Browser reported OFFLINE");
  });

  // Catch unhandled runtime exceptions
  window.addEventListener("error", (e) => {
    logError("UNCAUGHT_ERR", e.message || "Script error", {
      file: e.filename,
      line: e.lineno,
      col: e.colno,
    });
  });

  // Catch unhandled async / invoke promise rejections
  window.addEventListener("unhandledrejection", (e) => {
    const reason =
      e.reason instanceof Error
        ? `${e.reason.name}: ${e.reason.message}`
        : String(e.reason);
    logError("UNHANDLED_REJECTION", reason);
  });

  // Mirror console.warn & console.error into the session log
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.warn = (...args: unknown[]) => {
    origWarn(...args);
    logWarn("CONSOLE_WARN", args.map(String).join(" "));
  };

  console.error = (...args: unknown[]) => {
    origError(...args);
    logError("CONSOLE_ERR", args.map(String).join(" "));
  };
}