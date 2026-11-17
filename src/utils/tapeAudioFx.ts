import { convertFileSrc } from "@tauri-apps/api/core";

export class TurntableAudioDeck {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private currentBuffer: AudioBuffer | null = null;
  private timeDomainBuf = new Uint8Array(256);

  private volume = 0.85;
  private playing = false;
  private startCtxTime = 0;
  private pauseOffsetSec = 0;
  private opId = 0;
  private onStateChange: (playing: boolean) => void;

  constructor(onStateChange: (playing: boolean) => void) {
    this.onStateChange = onStateChange;
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = this.volume;

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.65;

      this.gainNode.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setVolume(val: number) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.015);
    }
  }

  public isPlaying(): boolean {
    return this.playing;
  }

  public getDuration(): number {
    return this.currentBuffer?.duration ?? 0;
  }

  public getCurrentTime(): number {
    if (!this.playing || !this.ctx) return this.pauseOffsetSec;
    return this.pauseOffsetSec + (this.ctx.currentTime - this.startCtxTime);
  }

  /** Reads live PCM samples directly from the Web Audio graph for the 3D VU meter */
  public getVuLevel(): number {
    if (!this.playing || !this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.timeDomainBuf);
    let sumSq = 0;
    for (let i = 0; i < this.timeDomainBuf.length; i++) {
      const norm = (this.timeDomainBuf[i] - 128) / 128;
      sumSq += norm * norm;
    }
    const rms = Math.sqrt(sumSq / this.timeDomainBuf.length);
    return Math.min(1.15, rms * 4.2);
  }

  private playMotorCue(direction: "start" | "stop", durationSec: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = "triangle";
      if (direction === "stop") {
        osc.frequency.setValueAtTime(110, now);
        osc.frequency.exponentialRampToValueAtTime(26, now + durationSec);
      } else {
        osc.frequency.setValueAtTime(30, now);
        osc.frequency.exponentialRampToValueAtTime(115, now + durationSec);
      }

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(220, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.045, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + durationSec);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + durationSec + 0.02);
    } catch {
      // Ignore if context is closing
    }
  }

  private async fetchAndDecode(
    streamUrl: string | undefined,
    masterWavPath: string
  ): Promise<AudioBuffer> {
    const ctx = this.ensureContext();
    let arrayBuf: ArrayBuffer | null = null;

    if (streamUrl) {
      try {
        const resp = await fetch(streamUrl);
        if (resp.ok) {
          arrayBuf = await resp.arrayBuffer();
        }
      } catch {
        // Fall back to Tauri asset protocol below
      }
    }

    if (!arrayBuf || arrayBuf.byteLength <= 4096) {
      const assetUrl = convertFileSrc(masterWavPath);
      const resp = await fetch(assetUrl);
      if (!resp.ok) {
        throw new Error(`Audio fetch HTTP ${resp.status}`);
      }
      arrayBuf = await resp.arrayBuffer();
    }

    if (arrayBuf.byteLength <= 4096) {
      throw new Error("Audio buffer is empty");
    }

    return await ctx.decodeAudioData(arrayBuf.slice(0));
  }

  private startBufferNode(buffer: AudioBuffer, offsetSec: number, rampMs: number) {
    const ctx = this.ensureContext();
    this.stopSourceImmediately();

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gainNode!);

    const now = ctx.currentTime;
    const rampSec = Math.max(0.05, rampMs / 1000);

    // True analog motor spin-up: pitch + speed ramp from 0.28x -> 1.00x
    src.playbackRate.setValueAtTime(0.28, now);
    src.playbackRate.exponentialRampToValueAtTime(1.0, now + rampSec);

    if (this.gainNode) {
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(this.volume, now);
    }

    const activeOp = this.opId;
    src.onended = () => {
      if (this.sourceNode === src && this.opId === activeOp) {
        this.playing = false;
        this.pauseOffsetSec = 0;
        this.onStateChange(false);
      }
    };

    const safeOffset = Math.max(0, Math.min(offsetSec, Math.max(0, buffer.duration - 0.1)));
    this.pauseOffsetSec = safeOffset;
    this.startCtxTime = now;
    this.sourceNode = src;
    this.playing = true;
    this.onStateChange(true);

    this.playMotorCue("start", rampSec);
    src.start(0, safeOffset);
  }

  private stopSourceImmediately() {
    if (this.sourceNode) {
      try {
        this.sourceNode.onended = null;
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch {
        // Already stopped
      }
      this.sourceNode = null;
    }
  }

  /** Decodes WAV into WebAudio memory and starts playback with an analog tape spin-up */
  public async loadAndTapeStart(
    streamUrl: string | undefined,
    masterWavPath: string,
    rampMs = 300
  ): Promise<void> {
    this.opId += 1;
    const myOp = this.opId;

    const buffer = await this.fetchAndDecode(streamUrl, masterWavPath);
    if (this.opId !== myOp) return;

    this.currentBuffer = buffer;
    this.pauseOffsetSec = 0;
    this.startBufferNode(buffer, 0, rampMs);
  }

  /** Resumes currently loaded track with an analog tape spin-up */
  public async tapeStartCurrent(rampMs = 300): Promise<void> {
    if (!this.currentBuffer) return;
    if (this.playing) return;
    this.opId += 1;
    this.startBufferNode(this.currentBuffer, this.pauseOffsetSec, rampMs);
  }

  /** Brakes pitch + speed down to a halt like a physical turntable platter */
  public async tapeStop(durationMs = 340): Promise<void> {
    this.opId += 1;
    const myOp = this.opId;

    if (!this.playing || !this.sourceNode || !this.ctx) {
      this.stopSourceImmediately();
      this.playing = false;
      this.onStateChange(false);
      return;
    }

    const ctx = this.ctx;
    const src = this.sourceNode;
    const now = ctx.currentTime;
    const durSec = Math.max(0.08, durationMs / 1000);

    // Save current needle position so pressing PLAY resumes from here
    const elapsed = now - this.startCtxTime;
    this.pauseOffsetSec = Math.min(
      this.currentBuffer?.duration ?? 0,
      this.pauseOffsetSec + elapsed * 0.85
    );

    try {
      src.playbackRate.cancelScheduledValues(now);
      src.playbackRate.setValueAtTime(Math.max(0.2, src.playbackRate.value), now);
      src.playbackRate.exponentialRampToValueAtTime(0.07, now + durSec);
    } catch {
      // Ignore if AudioParam state is busy
    }

    this.playMotorCue("stop", durSec);

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        if (this.opId === myOp) {
          this.stopSourceImmediately();
          this.playing = false;
          this.onStateChange(false);
        }
        resolve();
      }, durationMs);
    });
  }

  /** Hot-swaps an extended full-length buffer without interrupting playback */
  public async swapExtendedBuffer(
    streamUrl: string | undefined,
    masterWavPath: string
  ): Promise<void> {
    const buffer = await this.fetchAndDecode(streamUrl, masterWavPath);
    const currentPos = this.getCurrentTime();
    this.currentBuffer = buffer;
    if (this.playing) {
      this.opId += 1;
      this.startBufferNode(buffer, currentPos, 60);
    }
  }

  public destroy() {
    this.opId += 1;
    this.stopSourceImmediately();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}