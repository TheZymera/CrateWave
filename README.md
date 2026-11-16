<div align="center">

# 🎛️ CRATEWAVE

**A high-performance, multi-source desktop crate-digging studio & sample chopper built for beatmakers and sound designers.**

[![Tauri v2](https://img.shields.io/badge/Tauri-v2-24C8D8?style=for-the-badge&logo=tauri&logoColor=white)](https://v2.tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-Backend-DEA584?style=for-the-badge&logo=rust&logoColor=black)](https://www.rust-lang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)

</div>

---

## ⚡ About

**CrateWave** turns the open web into a tactile hardware sampler rack. Inspired by classic rackmount gear and bismuth crystal aesthetics, it simultaneously digs across obscure archives, independent uploads, and deep-cut catalogs—letting you audition, slice, transcode, and drag studio-ready `.wav` or `320kbps MP3` chops straight into your DAW in seconds.

### Key Highlights
* **Multi-Source Crate Engine:** Pulls fresh, unseen candidates across **YouTube**, **SoundCloud**, **Internet Archive**, and **Wikimedia Commons** with automatic dead-end rerolling and duplicate history tracking.
* **4 Specialized Digging Modes:**
  * **General Crate:** Balanced discovery across genres, eras, and sample types (drums, breaks, melodies, textures).
  * **World Adventure:** Global regional digging spanning Anatolian rock, Ethiopian jazz, Soviet synth, Japanese city pop, Brazilian bossa, and more.
  * **Only Instrumental:** Pure instrumental cuts, library music, and drum breaks with zero vocal clutter.
  * **Only Vocal:** Acapellas, vocal hooks, spoken word, and dedicated `#shorts` vocal flips.
* **Non-Destructive Waveform Chopper:** Interactive `WaveSurfer.js` bay with draggable `[IN]` / `[OUT]` region handles, loop auditioning (`Spacebar`), zoom controls, and precision FFmpeg trimming.
* **Single-Gesture DAW Drag-and-Drop:** Grab the **DRAG TO DAW** pad to drop your trimmed sample directly onto the timeline of **Ableton Live, FL Studio, Logic Pro, Reaper, or Studio One**.
* **Live Search Dictionary Bubbles:** Customize your randomizer pool directly inside the Settings modal using interactive tag bubbles synced live to `queries.json`.

---

## 🎚️ How to Use

### 1. Configure Your Dig
Select a **Digging Mode** on the bottom Control Deck and dial in your **Sample Type**, **Region**, **Decade**, **Duration**, **Genre**, and **Card Count** (`2`, `3`, or `4` cards per roll).

### 2. Roll the Crate
Click **ROLL CRATE** to query multiple sources simultaneously. Every rolled track is logged in your local history so you never dig the same record twice.

### 3. Preview & Load
* Click the **Play** button on any card for an instant inline preview.
* Click **LOAD & CHOP** to stream the audio in the background and decode a clean **44.1 kHz / 16-bit PCM Master WAV**.

### 4. Slice, Export & Drag to DAW
* Drag the **`[IN]`** and **`[OUT]`** region handles across the waveform and press **`Spacebar`** to audition your loop.
* Switch between **WAV** (lossless 16-bit PCM) and **MP3 320** in the top bar, then click **TRIM & EXPORT** to save the slice to `~/Music/My Samples`.
* Drag the **DRAG TO DAW** grip pad directly into your DAW's arrangement or sampler slot.

---

## 🛠️ Technology Stack

| Layer | Technologies | Role |
| :--- | :--- | :--- |
| **Desktop Shell & Core** | **Tauri v2**, **Rust**, **Tokio** | Native window management, async multi-source orchestration, zero-console sidecar execution |
| **Frontend & State** | **React 19**, **TypeScript**, **Tailwind CSS v4**, **Zustand** | Bismuth hardware-inspired dark UI, filter matrix, live progress arcs |
| **Media Discovery** | **`yt-dlp`**, **Reqwest**, **Internet Archive API**, **Wikimedia API** | Concurrent flat-playlist search, metadata resolution, direct audio streaming |
| **Audio DSP & Waveform** | **FFmpeg**, **FFprobe**, **WaveSurfer.js** | Master WAV transcoding, sample-accurate region slicing, interactive waveform rendering |
| **OS Integration** | **`tauri-plugin-drag`**, **`tauri-plugin-opener`**, **`tauri-plugin-fs`** | Native OS file drag-and-drop to DAWs, persistent `queries.json` & history storage |

---

## 🚀 Local Development Setup

### Prerequisites
* **Node.js** (v20+) & **npm**
* **Rust** toolchain (`rustup`, `cargo`)
* Sidecar binaries placed inside `src-tauri/binaries/` matching your target triple (e.g., for Windows x64):
  * `yt-dlp-x86_64-pc-windows-msvc.exe`
  * `ffmpeg-x86_64-pc-windows-msvc.exe`
  * `ffprobe-x86_64-pc-windows-msvc.exe`

### Run in Development Mode
```bash
npm install
npm run tauri dev
