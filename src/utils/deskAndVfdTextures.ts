import * as THREE from "three";

/** Generates procedural shabby worn studio oak/walnut desk textures */
export function createShabbyDeskTextures(): {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const size = 1024;

  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = size;
  colorCanvas.height = size;
  const ctx = colorCanvas.getContext("2d")!;

  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext("2d")!;

  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext("2d")!;

  // Base warm aged wood tone
  ctx.fillStyle = "#3c2719";
  ctx.fillRect(0, 0, size, size);
  bCtx.fillStyle = "#808080";
  bCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = "#b8b8b8";
  rCtx.fillRect(0, 0, size, size);

  // Horizontal wooden planks with subtle tone variation
  const plankCount = 6;
  const plankH = size / plankCount;
  const plankTones = ["#3d281a", "#352215", "#432c1c", "#382417", "#402a1b", "#332014"];

  for (let p = 0; p < plankCount; p++) {
    const y0 = p * plankH;
    ctx.fillStyle = plankTones[p % plankTones.length];
    ctx.fillRect(0, y0, size, plankH);

    // Fine wood grain fibers
    for (let i = 0; i < 160; i++) {
      const gy = y0 + ((i * 19 + p * 37) % plankH);
      const alpha = 0.04 + ((i * 7) % 10) * 0.008;
      ctx.strokeStyle = i % 2 === 0 ? `rgba(18, 9, 4, ${alpha})` : `rgba(110, 74, 46, ${alpha})`;
      ctx.lineWidth = 1 + (i % 3);
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.bezierCurveTo(
        size * 0.33,
        gy + Math.sin(i + p) * 4,
        size * 0.66,
        gy - Math.cos(i) * 4,
        size,
        gy
      );
      ctx.stroke();

      bCtx.strokeStyle = i % 2 === 0 ? "rgba(60,60,60,0.22)" : "rgba(185,185,185,0.18)";
      bCtx.lineWidth = 1;
      bCtx.beginPath();
      bCtx.moveTo(0, gy);
      bCtx.lineTo(size, gy);
      bCtx.stroke();
    }

    // Dark plank seam groove
    ctx.fillStyle = "rgba(14, 7, 3, 0.78)";
    ctx.fillRect(0, y0, size, 3);
    bCtx.fillStyle = "#181818";
    bCtx.fillRect(0, y0, size, 4);
  }

  // Subtle wood varnish grain variation (no dark oval blotches or rings)
  for (let s = 0; s < 28; s++) {
    const sy = ((s * 137) % size);
    const sh = 14 + (s % 4) * 10;
    ctx.fillStyle = s % 2 === 0 ? "rgba(128, 92, 60, 0.05)" : "rgba(24, 13, 6, 0.05)";
    ctx.fillRect(0, sy, size, sh);
  }

  // Fine micro-scratches along the grain
  for (let k = 0; k < 45; k++) {
    const kx = (k * 197) % size;
    const ky = (k * 311) % size;
    const len = 18 + (k % 36);
    const ang = ((k * 37) % 100) * 0.006 - 0.3;
    ctx.strokeStyle = "rgba(145, 108, 74, 0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(kx, ky);
    ctx.lineTo(kx + Math.cos(ang) * len, ky + Math.sin(ang) * len);
    ctx.stroke();

    bCtx.strokeStyle = "rgba(45, 45, 45, 0.28)";
    bCtx.beginPath();
    bCtx.moveTo(kx, ky);
    bCtx.lineTo(kx + Math.cos(ang) * len, ky + Math.sin(ang) * len);
    bCtx.stroke();
  }

  const configure = (c: HTMLCanvasElement, isColor: boolean) => {
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 2);
    if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };

  return {
    map: configure(colorCanvas, true),
    bumpMap: configure(bumpCanvas, false),
    roughnessMap: configure(roughCanvas, false),
  };
}

// 5x7 Dot-Matrix Bitmap Font for authentic CU16025-UW6J VFD Phosphor Rendering
const FONT_5X7: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11100", "10010", "10001", "10001", "10001", "10010", "11100"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "00100", "00100", "01000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "'": ["00100", "00100", "00000", "00000", "00000", "00000", "00000"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  ">": ["10000", "01000", "00100", "00010", "00100", "01000", "10000"],
  "<": ["00001", "00010", "00100", "01000", "00100", "00010", "00001"],
  "[": ["01110", "01000", "01000", "01000", "01000", "01000", "01110"],
  "]": ["01110", "00010", "00010", "00010", "00010", "00010", "01110"],
  "*": ["00100", "10101", "01110", "11111", "01110", "10101", "00100"],
  "^": ["00100", "01010", "10001", "00000", "00000", "00000", "00000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

export interface VfdRenderOptions {
  hoverRow?: number;
  flashRow?: number;
  cols?: number;
}

/** Draws a 2-to-4 line 5x7 dot-matrix cyan phosphor VFD onto a canvas */
export function drawFrontVfdCanvas(
  canvas: HTMLCanvasElement,
  linesInput: string[],
  options: VfdRenderOptions = {}
) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d")!;

  const hoverRow = options.hoverRow ?? -1;
  const flashRow = options.flashRow ?? -1;
  const rowCount = Math.max(1, linesInput.length);
  const cols = options.cols ?? (rowCount > 2 ? 32 : 18);

  ctx.fillStyle = "#030908";
  ctx.fillRect(0, 0, w, h);

  const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w * 0.55);
  bgGrad.addColorStop(0, "rgba(18, 52, 46, 0.34)");
  bgGrad.addColorStop(1, "rgba(2, 6, 5, 0.88)");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  const rowHeight = h / rowCount;
  const dotPitch = Math.max(2, Math.floor(Math.min(w / (cols * 6.2), rowHeight / 8.5)));
  const dotRadius = Math.max(1.2, dotPitch * 0.38);
  const charW = dotPitch * 6;
  const totalGridW = cols * charW;
  const startX = Math.floor((w - totalGridW) / 2);

  for (let row = 0; row < rowCount; row++) {
    const rawText = linesInput[row] ?? "";
    const text = rawText.toUpperCase().padEnd(cols, " ").slice(0, cols);
    const rowTop = row * rowHeight;
    const isFlashing = row === flashRow;
    const isHovered = row === hoverRow && !isFlashing;

    // Entire line turns solid glowing cyan when clicked
    if (isFlashing) {
      ctx.save();
      ctx.shadowColor = "#3efce0";
      ctx.shadowBlur = 18;
      ctx.fillStyle = "#6bfce4";
      ctx.fillRect(startX - 10, rowTop + 3, totalGridW + 20, rowHeight - 6);
      ctx.restore();
    } else if (isHovered) {
      ctx.fillStyle = "rgba(64, 245, 214, 0.13)";
      ctx.fillRect(startX - 10, rowTop + 3, totalGridW + 20, rowHeight - 6);
      ctx.strokeStyle = "rgba(110, 252, 228, 0.38)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(startX - 10, rowTop + 3, totalGridW + 20, rowHeight - 6);
    }

    const yBase = Math.floor(rowTop + (rowHeight - dotPitch * 7) / 2);

    for (let c = 0; c < cols; c++) {
      const ch = text[c] || " ";
      const glyph = FONT_5X7[ch] || FONT_5X7[" "];
      const cx0 = startX + c * charW;

      for (let gy = 0; gy < 7; gy++) {
        for (let gx = 0; gx < 5; gx++) {
          const px = cx0 + gx * dotPitch + dotPitch * 0.5;
          const py = yBase + gy * dotPitch + dotPitch * 0.5;
          const lit = glyph[gy][gx] === "1";

          if (isFlashing) {
            ctx.fillStyle = lit ? "#031412" : "rgba(3, 20, 18, 0.14)";
            ctx.beginPath();
            ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
            ctx.fill();
          } else if (lit) {
            ctx.save();
            ctx.shadowColor = "#2dd4bf";
            ctx.shadowBlur = dotPitch * 1.35;
            ctx.fillStyle = isHovered ? "#a8fff0" : "#7efce0";
            ctx.beginPath();
            ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          } else {
            ctx.fillStyle = "rgba(45, 212, 191, 0.065)";
            ctx.beginPath();
            ctx.arc(px, py, dotRadius * 0.85, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
  }
}