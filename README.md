# CrateWave

**CrateWave** is a lightweight, hardware-inspired desktop sample digger built with **Tauri v2 (Rust + React/TypeScript)**. Designed to run alongside heavy DAW sessions with minimal RAM/CPU overhead, it turns global audio archives and video platforms into an infinite crate of playable samples.

### Key Features
- **Infinite Multi-Source Digging:** Pulls 2–4 randomized candidates per roll from YouTube (quota-free hybrid search), Internet Archive, and Freesound.
- **Dedicated Digging Modes:** Switch instantly between **General Search**, **World Adventure** (global/multi-language digging by decade), **Only Vocal** (acapellas & `"sample this"` vocal shorts), and **Only Instrumental** (genre-filtered grooves & breaks).
- **On-Demand Audio Engine:** Browse freely without waiting; click **Load & Chop** to download and decode audio via bundled `yt-dlp` + `FFmpeg` with real-time radial progress tracking.
- **Precision Trimmer & Dual Export:** Audition loops with anti-click fades and export to **uncompressed WAV** or **320 kbps MP3**.
- **Direct DAW Drag-and-Drop:** Drag trimmed regions straight from the app window onto your timeline or sampler in Ableton Live, FL Studio, Logic Pro, Reaper, or Bitwig—while automatically archiving every chop to your `My Samples` folder.
