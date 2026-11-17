import * as THREE from "three";

export interface MetalTextureSet {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
}

export function createWarmChassisTextures(): MetalTextureSet {
  const size = 1024;
  const albedoCanvas = document.createElement("canvas");
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const ctx = albedoCanvas.getContext("2d")!;

  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext("2d")!;

  // Warm analog brushed champagne-gunmetal gradient
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, "#4b4742");
  grad.addColorStop(0.5, "#363330");
  grad.addColorStop(1, "#252321");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  bCtx.fillStyle = "#808080";
  bCtx.fillRect(0, 0, size, size);

  // Horizontal brushed grain
  for (let y = 0; y < size; y += 2) {
    const alpha = (Math.random() - 0.5) * 0.055;
    ctx.fillStyle =
      alpha > 0 ? `rgba(255,245,230,${alpha})` : `rgba(0,0,0,${-alpha})`;
    ctx.fillRect(0, y, size, 1);

    const bShade = Math.floor(128 + (Math.random() - 0.5) * 26);
    bCtx.fillStyle = `rgb(${bShade},${bShade},${bShade})`;
    bCtx.fillRect(0, y, size, 1);
  }

  // Fine metallic scratches & studio wear
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = 18 + Math.random() * 90;
    const angle = (Math.random() - 0.5) * 0.5;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle =
      Math.random() > 0.35
        ? `rgba(255,244,225,${0.035 + Math.random() * 0.05})`
        : `rgba(0,0,0,${0.12 + Math.random() * 0.14})`;
    ctx.lineWidth = 0.7 + Math.random() * 0.8;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(len, 0);
    ctx.stroke();
    ctx.restore();

    bCtx.save();
    bCtx.translate(x, y);
    bCtx.rotate(angle);
    bCtx.strokeStyle = "rgba(45,45,45,0.45)";
    bCtx.lineWidth = 1;
    bCtx.beginPath();
    bCtx.moveTo(0, 0);
    bCtx.lineTo(len, 0);
    bCtx.stroke();
    bCtx.restore();
  }

  const map = new THREE.CanvasTexture(albedoCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.anisotropy = 8;

  return { map, bumpMap };
}

export function createWalnutWoodTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#4a2816";
  ctx.fillRect(0, 0, size, size);

  for (let x = 0; x < size; x += 2) {
    const wave = Math.sin(x * 0.07) * 14;
    ctx.fillStyle =
      x % 6 === 0 ? "rgba(24, 10, 4, 0.38)" : "rgba(155, 92, 48, 0.22)";
    ctx.fillRect(x, 0, 2, size);
    ctx.fillStyle = "rgba(255, 195, 130, 0.06)";
    ctx.fillRect(x + (wave % 3), 0, 1, size);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface VinylTextureSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

export function createVinylTextures(): VinylTextureSet {
  const size = 1024;
  const half = size / 2;

  const mapCanvas = document.createElement("canvas");
  mapCanvas.width = size;
  mapCanvas.height = size;
  const ctx = mapCanvas.getContext("2d")!;

  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext("2d")!;

  ctx.fillStyle = "#08090b";
  ctx.fillRect(0, 0, size, size);

  rCtx.fillStyle = "#323232";
  rCtx.fillRect(0, 0, size, size);

  for (let r = 175; r < half - 10; r += 2) {
    const isBandGap =
      Math.abs(r - 265) < 3 || Math.abs(r - 355) < 3 || Math.abs(r - 445) < 3;
    ctx.beginPath();
    ctx.arc(half, half, r, 0, Math.PI * 2);
    ctx.strokeStyle = isBandGap
      ? "rgba(255,255,255,0.09)"
      : r % 4 === 0
      ? "rgba(255,255,255,0.038)"
      : "rgba(0,0,0,0.65)";
    ctx.lineWidth = isBandGap ? 2.2 : 1.1;
    ctx.stroke();

    rCtx.beginPath();
    rCtx.arc(half, half, r, 0, Math.PI * 2);
    rCtx.strokeStyle = isBandGap ? "#161616" : r % 4 === 0 ? "#4a4a4a" : "#262626";
    rCtx.lineWidth = 1.2;
    rCtx.stroke();
  }

  // Rotating micro-scratches & dust
  for (let i = 0; i < 65; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 190 + Math.random() * 290;
    const x = half + Math.cos(angle) * dist;
    const y = half + Math.sin(angle) * dist;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2 + (Math.random() - 0.5) * 0.4);
    ctx.strokeStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.08})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(12, 0);
    ctx.stroke();
    ctx.restore();
  }

  const normCanvas = document.createElement("canvas");
  normCanvas.width = size;
  normCanvas.height = size;
  const nCtx = normCanvas.getContext("2d")!;
  const imgData = nCtx.createImageData(size, size);
  const data = imgData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - half;
      const dy = y - half;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const idx = (y * size + x) * 4;

      if (dist > 170 && dist < half - 8) {
        const inv = 1 / (dist || 1);
        const rx = dx * inv;
        const ry = dy * inv;
        const wave = Math.sin(dist * 1.45) * 0.48;

        const nx = rx * wave;
        const ny = ry * wave;
        const nz = Math.sqrt(Math.max(0.1, 1 - nx * nx - ny * ny));

        data[idx] = Math.floor((nx * 0.5 + 0.5) * 255);
        data[idx + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
        data[idx + 2] = Math.floor((nz * 0.5 + 0.5) * 255);
        data[idx + 3] = 255;
      } else {
        data[idx] = 128;
        data[idx + 1] = 128;
        data[idx + 2] = 255;
        data[idx + 3] = 255;
      }
    }
  }
  nCtx.putImageData(imgData, 0, 0);

  const map = new THREE.CanvasTexture(mapCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const normalMap = new THREE.CanvasTexture(normCanvas);
  normalMap.anisotropy = 8;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.anisotropy = 8;

  return { map, normalMap, roughnessMap };
}

function drawCurvedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  charSpacingRad: number,
  bottomArc = false
) {
  const chars = text.split("");
  const totalAngle = (chars.length - 1) * charSpacingRad;

  chars.forEach((ch, i) => {
    const angle = bottomArc
      ? startAngle + totalAngle / 2 - i * charSpacingRad
      : startAngle - totalAngle / 2 + i * charSpacingRad;

    ctx.save();
    ctx.translate(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    ctx.rotate(bottomArc ? angle - Math.PI / 2 : angle + Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  });
}

export function drawRecordLabelCanvas(
  canvas: HTMLCanvasElement,
  title: string,
  subtitle: string,
  isLoading: boolean
) {
  const size = canvas.width;
  const half = size / 2;
  const ctx = canvas.getContext("2d")!;

  ctx.clearRect(0, 0, size, size);

  const bg = ctx.createRadialGradient(half * 0.85, half * 0.8, 30, half, half, half);
  bg.addColorStop(0, "#f2e7d0");
  bg.addColorStop(0.55, "#dbc9a7");
  bg.addColorStop(0.88, "#bfa880");
  bg.addColorStop(1, "#7c6747");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle =
      Math.random() > 0.5 ? "rgba(75,52,28,0.08)" : "rgba(255,250,238,0.12)";
    ctx.fillRect(x, y, 2, 2);
  }

  [165, 290, 445].forEach((r, idx) => {
    ctx.beginPath();
    ctx.arc(half, half, r, 0, Math.PI * 2);
    ctx.strokeStyle =
      idx === 1 ? "rgba(138, 43, 22, 0.55)" : "rgba(58, 38, 18, 0.32)";
    ctx.lineWidth = idx === 1 ? 5 : 3;
    ctx.stroke();
  });

  ctx.fillStyle = "#8a2b16";
  ctx.font = '800 30px "Fraunces", Georgia, serif';
  ctx.textAlign = "center";
  ctx.fillText(isLoading ? "DIGGING CRATE..." : "SIDE A • 33⅓ RPM", half, half - 145);

  ctx.fillStyle = "#2b1b0e";
  ctx.font = '700 22px "JetBrains Mono", monospace';
  ctx.fillText("CRATEWAVE ANALOG PRESS", half, half + 168);

  const cleanTitle = title.toUpperCase().slice(0, 38);
  ctx.fillStyle = "#1e1208";
  ctx.font = '900 34px "Fraunces", Georgia, serif';
  drawCurvedText(ctx, cleanTitle, half, half, 370, -Math.PI / 2, 0.068, false);

  const cleanSub = subtitle.toUpperCase().slice(0, 42);
  ctx.fillStyle = "#4a3018";
  ctx.font = '700 23px "JetBrains Mono", monospace';
  drawCurvedText(ctx, cleanSub, half, half, 375, Math.PI / 2, 0.055, true);

  ctx.beginPath();
  ctx.arc(half, half, 66, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(42, 26, 12, 0.25)";
  ctx.fillRect(0, 0, 0, 0);
  ctx.fill();
}

/** 3D Mode Key & Trim Keycap Top-Face Texture */
export interface KeyTextureSet {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
}

/** Photorealistic CNC-Brushed Metal & Backlit Diffuser Keycap Textures */
export function createRealisticKeyTextures(
  label: string,
  sublabel: string,
  active: boolean,
  isTrim = false
): KeyTextureSet {
  const w = 512;
  const h = 192;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = w;
  bumpCanvas.height = h;
  const bCtx = bumpCanvas.getContext("2d")!;

  // Base bead-blasted & brushed champagne/pewter aluminum body
  const baseGrad = ctx.createLinearGradient(0, 0, 0, h);
  if (active || isTrim) {
    baseGrad.addColorStop(0, "#756a5c");
    baseGrad.addColorStop(0.18, "#524a40");
    baseGrad.addColorStop(0.85, "#3d3730");
    baseGrad.addColorStop(1, "#292520");
  } else {
    baseGrad.addColorStop(0, "#686662");
    baseGrad.addColorStop(0.18, "#4b4946");
    baseGrad.addColorStop(0.85, "#363533");
    baseGrad.addColorStop(1, "#242322");
  }
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, w, h);

  bCtx.fillStyle = "#808080";
  bCtx.fillRect(0, 0, w, h);

  // Fine horizontal brushed metal grain & micro-speckle noise
  for (let y = 0; y < h; y++) {
    const shade = (Math.random() - 0.5) * 0.08;
    ctx.fillStyle =
      shade > 0 ? `rgba(255,248,235,${shade})` : `rgba(0,0,0,${-shade})`;
    ctx.fillRect(0, y, w, 1);

    const bVal = Math.floor(128 + (Math.random() - 0.5) * 38);
    bCtx.fillStyle = `rgb(${bVal},${bVal},${bVal})`;
    bCtx.fillRect(0, y, w, 1);
  }

  // Subtle surface wear scratches on keycap
  for (let i = 0; i < 24; i++) {
    const sx = Math.random() * w;
    const sy = Math.random() * h;
    const len = 14 + Math.random() * 48;
    ctx.strokeStyle = "rgba(255, 245, 225, 0.05)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + len, sy + (Math.random() - 0.5) * 4);
    ctx.stroke();
  }

  // Machined outer chamfer bevel highlight & shadow
  ctx.strokeStyle = "rgba(255, 245, 230, 0.24)";
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, w - 8, h - 8);

  ctx.strokeStyle = "rgba(0, 0, 0, 0.65)";
  ctx.lineWidth = 3;
  ctx.strokeRect(8, 8, w - 16, h - 16);

  // Recessed translucent acrylic light-pipe strip on right (Arturia / Studer style)
  const lensX = w - 62;
  const lensY = 34;
  const lensW = 24;
  const lensH = h - 68;

  ctx.fillStyle = "#161412";
  ctx.fillRect(lensX - 3, lensY - 3, lensW + 6, lensH + 6);

  const lensGrad = ctx.createLinearGradient(lensX, lensY, lensX + lensW, lensY);
  if (active || isTrim) {
    lensGrad.addColorStop(0, "#ffb347");
    lensGrad.addColorStop(0.5, "#fff3cc");
    lensGrad.addColorStop(1, "#e08e26");
  } else {
    lensGrad.addColorStop(0, "#4a4640");
    lensGrad.addColorStop(0.5, "#69645c");
    lensGrad.addColorStop(1, "#383530");
  }
  ctx.fillStyle = lensGrad;
  ctx.fillRect(lensX, lensY, lensW, lensH);

  // Engraved & ink-filled industrial chassis typography
  ctx.textAlign = "left";
  ctx.font = '800 44px "Barlow Condensed", sans-serif';

  // Engraved drop-highlight
  ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
  ctx.fillText(label, 34, sublabel ? 92 : 112);

  ctx.fillStyle = active || isTrim ? "#ffe6b3" : "#e3ddd1";
  ctx.fillText(label, 33, sublabel ? 90 : 110);

  if (sublabel) {
    ctx.font = '700 20px "JetBrains Mono", monospace';
    ctx.fillStyle = active ? "#f5bd6c" : "#a8a196";
    ctx.fillText(sublabel, 35, 136);
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.anisotropy = 8;

  return { map, bumpMap };
}
/** Vintage Ribbed Piano-Key Rocker Texture with Colored Accent Lip (Photo 2 & 3 Style) */
export function createPianoRockerTexture(
  label: string,
  accentColor: string,
  active: boolean
): THREE.CanvasTexture {
  const w = 256;
  const h = 384;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // Dark metallic-graphite key body
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, active ? "#545861" : "#3d4047");
  grad.addColorStop(0.75, active ? "#383b42" : "#26282e");
  grad.addColorStop(1, "#18191d");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Waffle / ribbed tactile grip lines (like Photo 2)
  ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
  for (let y = 32; y < 230; y += 14) {
    ctx.fillRect(28, y, w - 56, 6);
  }
  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  for (let y = 38; y < 230; y += 14) {
    ctx.fillRect(28, y, w - 56, 2);
  }

  // Colored front-edge indicator bar (cyan / ivory / emerald / crimson)
  ctx.fillStyle = accentColor;
  ctx.fillRect(22, 252, w - 44, 42);

  // Crisp engraved label below accent bar
  ctx.fillStyle = "#f2ede2";
  ctx.font = '800 44px "Barlow Condensed", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText(label, w / 2, 348);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Analog VU Meter Dial Face Texture */
export function createVuDialTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 280;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // Warm tungsten backlit paper card
  const bg = ctx.createRadialGradient(w / 2, h * 0.85, 20, w / 2, h * 0.65, w * 0.65);
  bg.addColorStop(0, "#fff0be");
  bg.addColorStop(0.55, "#f3b54b");
  bg.addColorStop(1, "#9a5d14");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Curved dB scale arc
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#23160a";
  ctx.beginPath();
  ctx.arc(w / 2, h * 1.12, 235, Math.PI * 1.24, Math.PI * 1.62);
  ctx.stroke();

  // Red overload zone
  ctx.lineWidth = 7;
  ctx.strokeStyle = "#b91c1c";
  ctx.beginPath();
  ctx.arc(w / 2, h * 1.12, 235, Math.PI * 1.62, Math.PI * 1.76);
  ctx.stroke();

  // dB numbers
  const ticks = [
    { txt: "-20", ang: Math.PI * 1.25, red: false },
    { txt: "10", ang: Math.PI * 1.34, red: false },
    { txt: "7", ang: Math.PI * 1.42, red: false },
    { txt: "5", ang: Math.PI * 1.49, red: false },
    { txt: "3", ang: Math.PI * 1.55, red: false },
    { txt: "0", ang: Math.PI * 1.62, red: false },
    { txt: "+1", ang: Math.PI * 1.69, red: true },
    { txt: "+3", ang: Math.PI * 1.75, red: true },
  ];

  ctx.font = '800 24px "JetBrains Mono", monospace';
  ctx.textAlign = "center";
  ticks.forEach((t) => {
    const r = 264;
    const x = w / 2 + Math.cos(t.ang) * r;
    const y = h * 1.12 + Math.sin(t.ang) * r;
    ctx.fillStyle = t.red ? "#b91c1c" : "#241608";
    ctx.fillText(t.txt, x, y);
  });

  ctx.fillStyle = "#3b240d";
  ctx.font = '800 28px "Barlow Condensed", sans-serif';
  ctx.fillText("MASTER VU • dB", w / 2, 185);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Greasy Fingerprint & Smudge Roughness Map for VU Glass Cover */
export function createGreasyGlassRoughnessMap(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#161616"; // Smooth glossy glass base
  ctx.fillRect(0, 0, size, size);

  // Subtle oily thumb smudges that catch warm studio light glares
  const smudges = [
    { x: 165, y: 140, rx: 52, ry: 34, rot: 0.4 },
    { x: 85, y: 95, rx: 38, ry: 25, rot: -0.3 },
    { x: 130, y: 185, rx: 45, ry: 22, rot: 0.15 },
  ];

  smudges.forEach((s) => {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, s.rx);
    g.addColorStop(0, "rgba(175, 175, 175, 0.65)");
    g.addColorStop(1, "rgba(22, 22, 22, 0)");
    ctx.fillStyle = g;
    ctx.scale(1, s.ry / s.rx);
    ctx.beginPath();
    ctx.arc(0, 0, s.rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  return new THREE.CanvasTexture(canvas);
}