import * as THREE from "three";

export function createStudioRoomTexture(): THREE.CanvasTexture {
  const width = 1280;
  const height = 720;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  // Warm tungsten studio room base gradient
  const roomGrad = ctx.createLinearGradient(0, 0, 0, height);
  roomGrad.addColorStop(0, "#2b1b12");
  roomGrad.addColorStop(0.45, "#3d2517");
  roomGrad.addColorStop(1, "#180f0a");
  ctx.fillStyle = roomGrad;
  ctx.fillRect(0, 0, width, height);

  // Left & Back Cedar Wood Acoustic Diffuser Panels
  const woodColors = ["#6e4226", "#875331", "#54311b", "#9c623b"];
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 18; col++) {
      ctx.fillStyle = woodColors[(row * 7 + col * 3) % woodColors.length];
      ctx.fillRect(45 + col * 32, 85 + row * 28, 28, 24);
    }
  }

  // Warm Ambient Studio Wall Lamps & Orange Backlight Glows
  const drawWarmLamp = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 4, x, y, r);
    g.addColorStop(0, "#fff5db");
    g.addColorStop(0.22, color);
    g.addColorStop(1, "rgba(255, 130, 45, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  drawWarmLamp(340, 290, 170, "rgba(255, 168, 76, 0.65)");
  drawWarmLamp(790, 220, 220, "rgba(255, 115, 40, 0.55)");
  drawWarmLamp(1140, 310, 180, "rgba(255, 205, 130, 0.7)");

  // Outboard Gear Rack & Glowing VU / Tube Lights on Right
  ctx.fillStyle = "#171311";
  ctx.fillRect(730, 175, 190, 290);
  for (let u = 0; u < 7; u++) {
    const y = 190 + u * 38;
    ctx.fillStyle = u % 2 === 0 ? "#2a2320" : "#1f1a17";
    ctx.fillRect(742, y, 166, 28);
    // Tiny glowing rack VU & LED indicators
    ctx.fillStyle = "#ffae42";
    ctx.fillRect(754, y + 8, 26, 12);
    ctx.fillStyle = "#ff5533";
    ctx.beginPath();
    ctx.arc(888, y + 14, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Warm Wooden Studio Console Desk & Faders in Foreground
  const deskGrad = ctx.createLinearGradient(0, 440, 0, height);
  deskGrad.addColorStop(0, "#9e6338");
  deskGrad.addColorStop(0.4, "#693f22");
  deskGrad.addColorStop(1, "#26150b");
  ctx.fillStyle = deskGrad;
  ctx.fillRect(0, 445, width, height - 445);

  // Console Channel Strips & Fader Caps
  ctx.fillStyle = "#22201f";
  ctx.fillRect(140, 510, 820, 190);
  for (let ch = 0; ch < 22; ch++) {
    const cx = 165 + ch * 35;
    ctx.fillStyle = "#5c5852";
    ctx.fillRect(cx, 535, 3, 130);
    ctx.fillStyle = "#e8e2d5";
    ctx.fillRect(cx - 5, 565 + ((ch * 19) % 65), 13, 18);
  }

  // Apply soft optical depth-of-field blur onto a second canvas
  const blurCanvas = document.createElement("canvas");
  blurCanvas.width = width;
  blurCanvas.height = height;
  const bCtx = blurCanvas.getContext("2d")!;
  bCtx.filter = "blur(9px) brightness(0.86) saturate(1.15)";
  bCtx.drawImage(canvas, -16, -16, width + 32, height + 32);

  // Subtle warm vignette around frame edges
  bCtx.filter = "none";
  const vig = bCtx.createRadialGradient(
    width / 2,
    height / 2,
    width * 0.25,
    width / 2,
    height / 2,
    width * 0.72
  );
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(12, 7, 4, 0.58)");
  bCtx.fillStyle = vig;
  bCtx.fillRect(0, 0, width, height);

  const tex = new THREE.CanvasTexture(blurCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}