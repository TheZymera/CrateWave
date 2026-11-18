import * as THREE from "three";

export interface TrimDialDrawOptions {
  title: string;
  peaks: number[];
  durationSec: number;
  trimStart: number; // 0..1
  trimEnd: number;   // 0..1
  playhead: number;  // 0..1
  isAuditioning: boolean;
  isExporting: boolean;
}

function formatTime(sec: number): string {
  const clamped = Math.max(0, sec);
  const mins = Math.floor(clamped / 60);
  const rem = clamped - mins * 60;
  return `${mins}:${rem.toFixed(2).padStart(5, "0")}`;
}

/**
 * Draws the illuminated USSR radiola frequency dial + live audio waveform
 * and movable IN / OUT tuning needles onto a high-DPI canvas.
 */
export function drawUssrTrimDialCanvas(
  canvas: HTMLCanvasElement,
  opts: TrimDialDrawOptions
) {
  const ctx = canvas.getContext("2d")!;
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  // 1. Deep obsidian-charcoal radio dial glass background with warm amber backlight glow
  const bgGrad = ctx.createRadialGradient(
    w * 0.5,
    h * 0.52,
    w * 0.06,
    w * 0.5,
    h * 0.52,
    w * 0.65
  );
  bgGrad.addColorStop(0, "#24190e");
  bgGrad.addColorStop(0.55, "#14110e");
  bgGrad.addColorStop(1, "#09090b");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // 2. Classic Soviet double-rule ivory border frame
  const padX = 24;
  const padY = 18;
  ctx.strokeStyle = "rgba(239, 228, 206, 0.82)";
  ctx.lineWidth = 2.5;
  ctx.strokeRect(padX, padY, w - padX * 2, h - padY * 2);

  ctx.strokeStyle = "rgba(239, 228, 206, 0.36)";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(padX + 6, padY + 6, w - (padX + 6) * 2, h - (padY + 6) * 2);

  // 3. Top Header Readout: [IN], LOOP SLICE DURATION, [OUT]
  const dur = Math.max(0.1, opts.durationSec);
  const inSec = opts.trimStart * dur;
  const outSec = opts.trimEnd * dur;
  const sliceSec = Math.max(0.01, outSec - inSec);

  ctx.font = "600 18px 'JetBrains Mono', monospace";
  ctx.textBaseline = "middle";

  ctx.fillStyle = "#f4e7ce";
  ctx.textAlign = "left";
  ctx.fillText(`[IN] ${formatTime(inSec)}`, padX + 18, padY + 26);

  ctx.fillStyle = opts.isExporting ? "#6bfce4" : "#ffbe5c";
  ctx.textAlign = "center";
  const centerHeader = opts.isExporting
    ? "EXPORTING SLICE..."
    : `LOOP SLICE • ${sliceSec.toFixed(2)}S`;
  ctx.fillText(centerHeader, w * 0.5, padY + 26);

  ctx.fillStyle = "#f4e7ce";
  ctx.textAlign = "right";
  ctx.fillText(`[OUT] ${formatTime(outSec)}`, w - padX - 18, padY + 26);

  // 4. Horizontal USSR Radio Band Lines & Frequency Ruler Ticks
  const plotLeft = padX + 54;
  const plotRight = w - padX - 24;
  const plotW = plotRight - plotLeft;
  const plotTop = padY + 52;
  const plotBottom = h - padY - 38;
  const plotH = plotBottom - plotTop;
  const centerY = plotTop + plotH * 0.5;

  const bandLabels = ["ДВ", "СВ", "КВ", "УКВ"];
  const bandRows = 4;
  for (let b = 0; b <= bandRows; b++) {
    const y = plotTop + (b / bandRows) * plotH;
    ctx.strokeStyle =
      b === 0 || b === bandRows
        ? "rgba(239, 228, 206, 0.72)"
        : "rgba(239, 228, 206, 0.26)";
    ctx.lineWidth = b === 0 || b === bandRows ? 1.8 : 1.0;
    ctx.beginPath();
    ctx.moveTo(padX + 14, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();

    if (b < bandRows) {
      const bandCenterY = y + plotH / (bandRows * 2);
      ctx.fillStyle = "rgba(239, 228, 206, 0.78)";
      ctx.font = "700 15px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText(bandLabels[b], padX + 32, bandCenterY);
    }
  }

  // Fine vernier tick marks along top and bottom scale rails
  const tickCount = 60;
  for (let t = 0; t <= tickCount; t++) {
    const tx = plotLeft + (t / tickCount) * plotW;
    const isMajor = t % 10 === 0;
    const isMid = t % 5 === 0;
    const tickLen = isMajor ? 11 : isMid ? 7 : 4;

    ctx.strokeStyle = isMajor
      ? "rgba(239, 228, 206, 0.85)"
      : "rgba(239, 228, 206, 0.42)";
    ctx.lineWidth = isMajor ? 1.6 : 1;

    // Top rail ticks
    ctx.beginPath();
    ctx.moveTo(tx, plotTop);
    ctx.lineTo(tx, plotTop + tickLen);
    ctx.stroke();

    // Bottom rail ticks
    ctx.beginPath();
    ctx.moveTo(tx, plotBottom);
    ctx.lineTo(tx, plotBottom - tickLen);
    ctx.stroke();

    if (isMajor && t < tickCount) {
      const secMark = (t / tickCount) * dur;
      ctx.fillStyle = "rgba(239, 228, 206, 0.65)";
      ctx.font = "500 13px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${secMark.toFixed(0)}s`, tx, plotBottom + 16);
    }
  }

  // 5. Active Loop Selection Window
  const inX = plotLeft + Math.max(0, Math.min(1, opts.trimStart)) * plotW;
  const outX = plotLeft + Math.max(0, Math.min(1, opts.trimEnd)) * plotW;

  // Dimmed mask outside selected slice
  ctx.fillStyle = "rgba(5, 5, 7, 0.46)";
  ctx.fillRect(plotLeft, plotTop + 1, Math.max(0, inX - plotLeft), plotH - 2);
  ctx.fillRect(outX, plotTop + 1, Math.max(0, plotRight - outX), plotH - 2);

  // Warm illuminated window inside selected slice
  const selGrad = ctx.createLinearGradient(0, plotTop, 0, plotBottom);
  selGrad.addColorStop(0, "rgba(255, 184, 77, 0.24)");
  selGrad.addColorStop(0.5, "rgba(255, 162, 48, 0.12)");
  selGrad.addColorStop(1, "rgba(255, 184, 77, 0.24)");
  ctx.fillStyle = selGrad;
  ctx.fillRect(inX, plotTop + 1, Math.max(2, outX - inX), plotH - 2);

  // 6. Audio Waveform Bars (inside the Soviet radio bands)
  const peaks =
    opts.peaks.length > 0
      ? opts.peaks
      : Array.from({ length: 140 }, (_, i) =>
          0.18 + 0.55 * Math.abs(Math.sin(i * 0.23) * Math.cos(i * 0.07))
        );
  const barCount = peaks.length;
  const barStep = plotW / barCount;
  const barW = Math.max(2, barStep * 0.64);
  const maxAmp = plotH * 0.42;

  for (let i = 0; i < barCount; i++) {
    const normX = (i + 0.5) / barCount;
    const bx = plotLeft + i * barStep;
    const amp = Math.max(0.05, Math.min(1, peaks[i])) * maxAmp;
    const insideSlice = normX >= opts.trimStart && normX <= opts.trimEnd;

    ctx.fillStyle = insideSlice
      ? "#ffbe55"
      : "rgba(219, 198, 162, 0.34)";
    ctx.fillRect(bx, centerY - amp, barW, amp * 2);
  }

  // 7. Soviet Radio Vernier Tuning Needles for IN & OUT
  const drawVernierNeedle = (x: number, label: string, color: string) => {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, plotTop - 4);
    ctx.lineTo(x, plotBottom + 4);
    ctx.stroke();

    // Top & bottom triangular pointer flags
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - 8, plotTop - 6);
    ctx.lineTo(x + 8, plotTop - 6);
    ctx.lineTo(x, plotTop + 6);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(x - 8, plotBottom + 6);
    ctx.lineTo(x + 8, plotBottom + 6);
    ctx.lineTo(x, plotBottom - 6);
    ctx.closePath();
    ctx.fill();

    ctx.font = "700 13px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, x, plotBottom + 18);
    ctx.restore();
  };

  drawVernierNeedle(inX, "IN", "#ff9e3d");
  drawVernierNeedle(outX, "OUT", "#ff6b4a");

  // 8. Live Audition Playhead Needle
  if (opts.isAuditioning) {
    const px = plotLeft + Math.max(0, Math.min(1, opts.playhead)) * plotW;
    ctx.save();
    ctx.strokeStyle = "#6bfce4";
    ctx.shadowColor = "#6bfce4";
    ctx.shadowBlur = 8;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, plotTop);
    ctx.lineTo(px, plotBottom);
    ctx.stroke();
    ctx.restore();
  }
}

/** Creates an ivory Soviet radio piano-key top texture */
export function createIvoryPianoKeyTexture(
  label: string,
  subLabel: string,
  accentColor = "#2b2116",
  active = false
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;

  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  if (active) {
    grad.addColorStop(0, "#ffe0a3");
    grad.addColorStop(1, "#e8b968");
  } else {
    grad.addColorStop(0, "#f5ecd9");
    grad.addColorStop(0.75, "#e6d8bd");
    grad.addColorStop(1, "#cbb999");
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  // Subtle top highlight & molded lip edge
  ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 244);

  ctx.fillStyle = accentColor;
  ctx.font = "700 40px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 256, subLabel ? 104 : 128);

  if (subLabel) {
    ctx.fillStyle = "rgba(43, 33, 22, 0.72)";
    ctx.font = "600 22px 'JetBrains Mono', monospace";
    ctx.fillText(subLabel, 256, 164);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Creates the dark anodized faceplate with Soviet ivory pinstripes & knob labels */
export function createTrimFaceplateTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#16171b";
  ctx.fillRect(0, 0, 1024, 512);

  // Classic Soviet ivory horizontal trim stripes flanking the knobs
  ctx.fillStyle = "rgba(239, 228, 206, 0.78)";
  ctx.fillRect(24, 62, 148, 4);
  ctx.fillRect(24, 282, 148, 4);
  ctx.fillRect(852, 62, 148, 4);
  ctx.fillRect(852, 282, 148, 4);

  ctx.fillStyle = "#efe4ce";
  ctx.font = "700 20px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillText("IN • START", 98, 314);
  ctx.fillText("OUT • END", 926, 314);

  ctx.fillStyle = "rgba(239, 228, 206, 0.45)";
  ctx.font = "600 15px 'JetBrains Mono', monospace";
  ctx.fillText("РАДИОЛА • TAPE CHOPPER", 512, 26);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}