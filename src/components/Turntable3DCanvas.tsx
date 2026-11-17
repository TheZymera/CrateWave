import { useEffect, useRef } from "react";
import * as THREE from "three";
import { createStudioRoomTexture } from "../utils/studioBackdrop";
import {
  createGreasyGlassRoughnessMap,
  createPianoRockerTexture,
  createRealisticKeyTextures,
  createVinylTextures,
  createVuDialTexture,
  createWalnutWoodTexture,
  createWarmChassisTextures,
  drawRecordLabelCanvas,
} from "../utils/proceduralTextures";
import type { DigMode } from "../types/crate";

interface Turntable3DCanvasProps {
  title: string;
  subtitle: string;
  activeMode: DigMode;
  isPlaying: boolean;
  isLoading: boolean;
  hasActiveSample: boolean;
  vuLevel: number;
  masterVolume: number;
  onSelectMode: (mode: DigMode) => void;
  onClickCenterLabel: () => void;
  onPlay: () => void;
  onStop: () => void;
  onOpenTrim: () => void;
  onChangeVolume: (val: number) => void;
}

const MODE_DEFS: { id: DigMode; label: string; sub: string }[] = [
  { id: "general", label: "GENERAL", sub: "ALL CRATES" },
  { id: "world_adventure", label: "WORLD", sub: "GLOBAL DIG" },
  { id: "only_instrumental", label: "INSTRUMENTAL", sub: "NO VOCALS" },
  { id: "only_vocal", label: "VOCAL", sub: "ACAPELLA" },
];

type ModeMaterialMap = Map<DigMode, THREE.MeshStandardMaterial>;

/** Loads `/studio-bg.jpg` and applies a realistic optical depth-of-field blur */
function loadBlurredStudioPhoto(
  onLoaded: (tex: THREE.CanvasTexture) => void
) {
  const img = new Image();
  img.src = "/studio-bg.jpg";
  img.onload = () => {
    const w = 1440;
    const h = 810;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;

    // Slight perspective tilt & optical lens blur so the studio room sits naturally behind the deck
    ctx.save();
    ctx.filter = "blur(13px) brightness(0.8) contrast(1.06) saturate(1.12)";
    ctx.drawImage(img, -28, -28, w + 56, h + 56);
    ctx.restore();

    // Soft warm studio vignette
    const vig = ctx.createRadialGradient(
      w / 2,
      h / 2,
      w * 0.24,
      w / 2,
      h / 2,
      w * 0.72
    );
    vig.addColorStop(0, "rgba(0, 0, 0, 0)");
    vig.addColorStop(1, "rgba(10, 6, 4, 0.55)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    onLoaded(tex);
  };
}

export function Turntable3DCanvas({
  title,
  subtitle,
  activeMode,
  isPlaying,
  isLoading,
  hasActiveSample,
  vuLevel,
  masterVolume,
  onSelectMode,
  onClickCenterLabel,
  onPlay,
  onStop,
  onOpenTrim,
  onChangeVolume,
}: Turntable3DCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  const isPlayingRef = useRef(isPlaying);
  const isLoadingRef = useRef(isLoading);
  const hasSampleRef = useRef(hasActiveSample);
  const activeModeRef = useRef(activeMode);
  const vuLevelRef = useRef(vuLevel);
  const volumeRef = useRef(masterVolume);

  const labelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelTexRef = useRef<THREE.CanvasTexture | null>(null);
  const modeMaterialsRef = useRef<ModeMaterialMap>(new Map());
  const centerPressBounceRef = useRef(0);

  const callbacksRef = useRef({
    onSelectMode,
    onClickCenterLabel,
    onPlay,
    onStop,
    onOpenTrim,
    onChangeVolume,
  });

  useEffect(() => {
    callbacksRef.current = {
      onSelectMode,
      onClickCenterLabel,
      onPlay,
      onStop,
      onOpenTrim,
      onChangeVolume,
    };
  }, [onSelectMode, onClickCenterLabel, onPlay, onStop, onOpenTrim, onChangeVolume]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    hasSampleRef.current = hasActiveSample;
  }, [hasActiveSample]);

  useEffect(() => {
    vuLevelRef.current = vuLevel;
  }, [vuLevel]);

  useEffect(() => {
    volumeRef.current = masterVolume;
  }, [masterVolume]);

  // Update 3D Mode Keycap PBR Textures when activeMode changes
  useEffect(() => {
    activeModeRef.current = activeMode;
    MODE_DEFS.forEach((m) => {
      const mat = modeMaterialsRef.current.get(m.id);
      if (mat) {
        const oldMap = mat.map;
        const oldBump = mat.bumpMap;
        const texSet = createRealisticKeyTextures(m.label, m.sub, activeMode === m.id);
        mat.map = texSet.map;
        mat.bumpMap = texSet.bumpMap;
        mat.emissive = new THREE.Color(activeMode === m.id ? "#ffae42" : "#000000");
        mat.emissiveIntensity = activeMode === m.id ? 0.18 : 0;
        mat.needsUpdate = true;
        oldMap?.dispose();
        oldBump?.dispose();
      }
    });
  }, [activeMode]);

  // Redraw curved Fraunces carton label when track changes
  useEffect(() => {
    if (labelCanvasRef.current && labelTexRef.current) {
      drawRecordLabelCanvas(labelCanvasRef.current, title, subtitle, isLoading);
      labelTexRef.current.needsUpdate = true;
    }
  }, [title, subtitle, isLoading]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    // Immediate procedural studio backdrop, replaced seamlessly by `/studio-bg.jpg` once loaded
    scene.background = createStudioRoomTexture();
    loadBlurredStudioPhoto((photoTex) => {
      scene.background = photoTex;
    });

    const width = container.clientWidth || 1280;
    const height = container.clientHeight || 720;

    // Camera pulled further back so the entire 3D player + blurred studio room frame cleanly
    const camera = new THREE.PerspectiveCamera(31, width / height, 0.1, 60);
    camera.position.set(0, 9.75, 4.15);
    camera.lookAt(0, -0.05, 0.05);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.24;
    container.appendChild(renderer.domElement);

    // Warm Analog Studio Three-Point Lighting
    const hemiLight = new THREE.HemisphereLight("#ffefd6", "#2a1d17", 0.95);
    scene.add(hemiLight);

    const keyLight = new THREE.SpotLight("#ffebd2", 95);
    keyLight.position.set(-4.0, 9.2, 3.8);
    keyLight.angle = Math.PI / 3.2;
    keyLight.penumbra = 0.72;
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.bias = -0.0004;
    scene.add(keyLight);

    const warmRightLamp = new THREE.PointLight("#ffbe6b", 15, 16);
    warmRightLamp.position.set(4.8, 4.0, 1.5);
    scene.add(warmRightLamp);

    const coolRimLight = new THREE.DirectionalLight("#ffd9a8", 1.9);
    coolRimLight.position.set(3.5, 6.2, -4.2);
    scene.add(coolRimLight);

    // ================= 1. 3D TURNTABLE CHASSIS WITH WALNUT SIDE CHEEKS =================
    const chassisTex = createWarmChassisTextures();
    const plinthMat = new THREE.MeshStandardMaterial({
      map: chassisTex.map,
      bumpMap: chassisTex.bumpMap,
      bumpScale: 0.015,
      metalness: 0.74,
      roughness: 0.32,
    });
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(8.9, 0.48, 5.2), plinthMat);
    plinth.position.set(0, -0.24, 0.05);
    plinth.receiveShadow = true;
    plinth.castShadow = true;
    scene.add(plinth);

    const walnutMat = new THREE.MeshStandardMaterial({
      map: createWalnutWoodTexture(),
      roughness: 0.42,
      metalness: 0.08,
    });
    const leftWood = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.54, 5.3), walnutMat);
    leftWood.position.set(-4.56, -0.22, 0.05);
    leftWood.castShadow = true;
    leftWood.receiveShadow = true;
    scene.add(leftWood);

    const rightWood = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.54, 5.3), walnutMat);
    rightWood.position.set(4.56, -0.22, 0.05);
    rightWood.castShadow = true;
    rightWood.receiveShadow = true;
    scene.add(rightWood);

    // 4 Corner Slotted Chassis Screws
    const chromeMat = new THREE.MeshStandardMaterial({
      color: "#e6eaf0",
      metalness: 0.95,
      roughness: 0.14,
    });
    const screwGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.03, 20);
    [
      [-4.22, -2.35],
      [4.22, -2.35],
      [-4.22, 2.45],
      [4.22, 2.45],
    ].forEach(([sx, sz]) => {
      const screw = new THREE.Mesh(screwGeo, chromeMat);
      screw.position.set(sx, 0.015, sz);
      scene.add(screw);
    });

    // ================= 2. 3D STEPPED PLATTER & SPINNING VINYL =================
    const platterCenterX = -0.08;
    const platterCenterZ = -0.32;

    const platterWell = new THREE.Mesh(
      new THREE.CylinderGeometry(2.18, 2.18, 0.04, 96),
      new THREE.MeshStandardMaterial({ color: "#0b0c0f", roughness: 0.85 })
    );
    platterWell.position.set(platterCenterX, 0.01, platterCenterZ);
    platterWell.receiveShadow = true;
    scene.add(platterWell);

    const platterGroup = new THREE.Group();
    platterGroup.position.set(platterCenterX, 0.055, platterCenterZ);
    scene.add(platterGroup);

    const platterMat = new THREE.MeshStandardMaterial({
      color: "#888e99",
      metalness: 0.88,
      roughness: 0.22,
    });
    const platterBase = new THREE.Mesh(
      new THREE.CylinderGeometry(2.08, 2.15, 0.14, 96),
      platterMat
    );
    platterBase.castShadow = true;
    platterBase.receiveShadow = true;
    platterGroup.add(platterBase);

    // Luminous Strobe Dots Ring
    const strobeRing = new THREE.Group();
    const dotGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.012, 10);
    const dotMat = new THREE.MeshStandardMaterial({
      color: "#fff0d4",
      emissive: "#ffb347",
      emissiveIntensity: 0.45,
      metalness: 0.9,
      roughness: 0.2,
    });
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.set(Math.cos(a) * 2.1, 0.02, Math.sin(a) * 2.1);
      dot.rotation.z = Math.PI / 2;
      dot.rotation.y = -a;
      strobeRing.add(dot);
    }
    platterGroup.add(strobeRing);

    // Spinning Black PVC Vinyl Disc + Carton Center Label
    const vinylSpinGroup = new THREE.Group();
    vinylSpinGroup.position.y = 0.082;
    platterGroup.add(vinylSpinGroup);

    const vinylTex = createVinylTextures();
    const vinylDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(2.01, 2.01, 0.028, 128),
      new THREE.MeshPhysicalMaterial({
        map: vinylTex.map,
        normalMap: vinylTex.normalMap,
        normalScale: new THREE.Vector2(0.9, 0.9),
        roughnessMap: vinylTex.roughnessMap,
        roughness: 0.22,
        metalness: 0.16,
        clearcoat: 0.85,
        clearcoatRoughness: 0.14,
      })
    );
    vinylDisc.castShadow = true;
    vinylDisc.receiveShadow = true;
    vinylSpinGroup.add(vinylDisc);

    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 1024;
    labelCanvas.height = 1024;
    drawRecordLabelCanvas(labelCanvas, title, subtitle, isLoading);
    labelCanvasRef.current = labelCanvas;

    const labelTex = new THREE.CanvasTexture(labelCanvas);
    labelTex.colorSpace = THREE.SRGBColorSpace;
    labelTex.anisotropy = 8;
    labelTexRef.current = labelTex;

    const labelMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.71, 0.71, 0.034, 96),
      new THREE.MeshStandardMaterial({
        map: labelTex,
        roughness: 0.82,
        metalness: 0.04,
      })
    );
    labelMesh.position.y = 0.004;
    labelMesh.receiveShadow = true;
    vinylSpinGroup.add(labelMesh);

    const spindle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.052, 0.062, 0.22, 32),
      chromeMat
    );
    spindle.position.y = 0.11;
    spindle.castShadow = true;
    vinylSpinGroup.add(spindle);

    // ================= 3. ARTICULATED 3D CHROME TONEARM (SWINGS LEFT ONTO DISK) =================
    const tonearmBaseGroup = new THREE.Group();
    tonearmBaseGroup.position.set(2.14, 0.06, -1.66);
    scene.add(tonearmBaseGroup);

    const gimbalBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.38, 0.18, 48),
      platterMat
    );
    gimbalBase.castShadow = true;
    tonearmBaseGroup.add(gimbalBase);

    // Tonearm rest post outside platter rim (x=2.21, z=0.32)
    const restPost = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.045, 0.16, 16),
      chromeMat
    );
    restPost.position.set(2.21, 0.08, 0.32);
    scene.add(restPost);

    const armPivotGroup = new THREE.Group();
    armPivotGroup.position.set(0, 0.22, 0);
    tonearmBaseGroup.add(armPivotGroup);

    const counterweight = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.24, 32),
      chromeMat
    );
    counterweight.rotation.x = Math.PI / 2;
    counterweight.position.set(0, 0.02, -0.32);
    counterweight.castShadow = true;
    armPivotGroup.add(counterweight);

    const sCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.02, -0.2),
      new THREE.Vector3(0, 0.04, 0.5),
      new THREE.Vector3(-0.22, 0.02, 1.25),
      new THREE.Vector3(-0.42, -0.02, 1.88),
    ]);
    const tubeMesh = new THREE.Mesh(
      new THREE.TubeGeometry(sCurve, 48, 0.03, 16, false),
      chromeMat
    );
    tubeMesh.castShadow = true;
    armPivotGroup.add(tubeMesh);

    const headshell = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.055, 0.28),
      new THREE.MeshStandardMaterial({ color: "#1c1f26", metalness: 0.72, roughness: 0.25 })
    );
    headshell.position.set(-0.46, -0.03, 2.0);
    headshell.rotation.y = 0.24;
    headshell.castShadow = true;
    armPivotGroup.add(headshell);

    const stylusLed = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 12, 12),
      new THREE.MeshBasicMaterial({ color: "#ffb347" })
    );
    stylusLed.position.set(-0.49, -0.05, 2.11);
    armPivotGroup.add(stylusLed);

    // ================= 4. LEFT BANK: 4 PHOTOREALISTIC 3D CNC MODE KEYS =================
    const interactiveObjects: THREE.Object3D[] = [labelMesh, spindle];
    const modeMeshes: { mode: DigMode; mesh: THREE.Mesh }[] = [];

    const bezelMat = new THREE.MeshStandardMaterial({
      color: "#121317",
      metalness: 0.75,
      roughness: 0.35,
    });
    const metalSideMat = new THREE.MeshStandardMaterial({
      color: "#4a4844",
      metalness: 0.82,
      roughness: 0.26,
    });

    MODE_DEFS.forEach((m, idx) => {
      const zPos = -1.78 + idx * 0.8;
      const xPos = -3.45;

      // Machined dark-anodized outer bezel frame
      const slot = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.06, 0.64), bezelMat);
      slot.position.set(xPos, 0.02, zPos);
      slot.receiveShadow = true;
      scene.add(slot);

      const texSet = createRealisticKeyTextures(m.label, m.sub, activeModeRef.current === m.id);
      const topMat = new THREE.MeshStandardMaterial({
        map: texSet.map,
        bumpMap: texSet.bumpMap,
        bumpScale: 0.012,
        metalness: 0.72,
        roughness: 0.26,
        emissive: new THREE.Color(activeModeRef.current === m.id ? "#ffae42" : "#000000"),
        emissiveIntensity: activeModeRef.current === m.id ? 0.18 : 0,
      });
      modeMaterialsRef.current.set(m.id, topMat);

      const keyCap = new THREE.Mesh(
        new THREE.BoxGeometry(1.36, 0.14, 0.54),
        [metalSideMat, metalSideMat, topMat, metalSideMat, metalSideMat, metalSideMat]
      );
      keyCap.position.set(xPos, 0.09, zPos);
      keyCap.castShadow = true;
      keyCap.receiveShadow = true;
      keyCap.userData = { action: "mode", mode: m.id };
      scene.add(keyCap);

      interactiveObjects.push(keyCap);
      modeMeshes.push({ mode: m.id, mesh: keyCap });
    });

    // ================= 5. PLAY & STOP PIANO-KEY ROCKERS (SNUG AT CENTER OF LOWER-LEFT ARC) =================
    const rockerConfigs = [
      { id: "play", label: "PLAY", color: "#34d399", angle: Math.PI * 0.735 },
      { id: "stop", label: "STOP", color: "#fb7185", angle: Math.PI * 0.665 },
    ];

    const arcRadius = 2.42;
    let playRockerMesh: THREE.Mesh | null = null;
    let stopRockerMesh: THREE.Mesh | null = null;

    rockerConfigs.forEach((rk) => {
      const rx = platterCenterX + Math.cos(rk.angle) * arcRadius;
      const rz = platterCenterZ + Math.sin(rk.angle) * arcRadius;
      const rotY = -rk.angle + Math.PI / 2;

      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.64), bezelMat);
      slot.position.set(rx, 0.025, rz);
      slot.rotation.y = rotY;
      slot.receiveShadow = true;
      scene.add(slot);

      const topTex = createPianoRockerTexture(rk.label, rk.color, false);
      const topMat = new THREE.MeshStandardMaterial({
        map: topTex,
        metalness: 0.45,
        roughness: 0.26,
      });
      const darkBodyMat = new THREE.MeshStandardMaterial({
        color: "#23262d",
        metalness: 0.65,
        roughness: 0.3,
      });

      const keyMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.16, 0.56),
        [darkBodyMat, darkBodyMat, topMat, darkBodyMat, darkBodyMat, darkBodyMat]
      );
      keyMesh.position.set(rx, 0.095, rz);
      keyMesh.rotation.y = rotY;
      keyMesh.castShadow = true;
      keyMesh.receiveShadow = true;
      keyMesh.userData = { action: rk.id };
      interactiveObjects.push(keyMesh);

      if (rk.id === "play") playRockerMesh = keyMesh;
      if (rk.id === "stop") stopRockerMesh = keyMesh;

      scene.add(keyMesh);
    });

    // ================= 6. BOTTOM-CENTER 3D TRIM KEY (AT BOTTOM EDGE OF DISK) =================
    const trimSlot = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.07, 0.44), bezelMat);
    trimSlot.position.set(platterCenterX, 0.03, 2.08);
    scene.add(trimSlot);

    const trimTexSet = createRealisticKeyTextures("✂ TRIM", "", true, true);
    const trimTopMat = new THREE.MeshStandardMaterial({
      map: trimTexSet.map,
      bumpMap: trimTexSet.bumpMap,
      bumpScale: 0.012,
      metalness: 0.72,
      roughness: 0.24,
      emissive: new THREE.Color("#ffae42"),
      emissiveIntensity: 0.22,
    });
    const trimKeyMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.16, 0.16, 0.36),
      [metalSideMat, metalSideMat, trimTopMat, metalSideMat, metalSideMat, metalSideMat]
    );
    trimKeyMesh.position.set(platterCenterX, -0.05, 2.08);
    trimKeyMesh.castShadow = true;
    trimKeyMesh.userData = { action: "trim" };
    scene.add(trimKeyMesh);
    interactiveObjects.push(trimKeyMesh);

    // ================= 7. UPPER-RIGHT 3D MASTER VU METER (NO LED LIGHT — ONLY MOVING LINE) =================
    const vuGroup = new THREE.Group();
    vuGroup.position.set(2.92, 0.04, -1.55);
    vuGroup.rotation.x = 0.14;
    scene.add(vuGroup);

    const housingMat = new THREE.MeshStandardMaterial({
      color: "#22242a",
      metalness: 0.86,
      roughness: 0.24,
    });

    // Recessed floor plate
    const vuFloor = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.04, 0.94), housingMat);
    vuFloor.position.y = 0.01;
    vuGroup.add(vuFloor);

    // 4 Raised Outer Bezel Walls (forming a deep recessed window)
    const wallTop = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.14, 0.08), housingMat);
    wallTop.position.set(0, 0.07, -0.43);
    wallTop.castShadow = true;
    vuGroup.add(wallTop);

    const wallBot = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.14, 0.08), housingMat);
    wallBot.position.set(0, 0.07, 0.43);
    wallBot.castShadow = true;
    vuGroup.add(wallBot);

    const wallLeft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.94), housingMat);
    wallLeft.position.set(-0.7, 0.07, 0);
    wallLeft.castShadow = true;
    vuGroup.add(wallLeft);

    const wallRight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.94), housingMat);
    wallRight.position.set(0.7, 0.07, 0);
    wallRight.castShadow = true;
    vuGroup.add(wallRight);

    // Warm Tungsten-Lit Dial Card (Sitting cleanly above floor at y=0.04)
    const vuDialTex = createVuDialTexture();
    const vuDial = new THREE.Mesh(
      new THREE.PlaneGeometry(1.32, 0.78),
      new THREE.MeshStandardMaterial({
        map: vuDialTex,
        emissive: new THREE.Color("#ffb347"),
        emissiveMap: vuDialTex,
        emissiveIntensity: 0.65,
        roughness: 0.55,
      })
    );
    vuDial.rotation.x = -Math.PI / 2;
    vuDial.position.y = 0.04;
    vuGroup.add(vuDial);

    // Moving Needle Line Only (No LED light)
    const needlePivot = new THREE.Group();
    needlePivot.position.set(0, 0.062, 0.34);
    vuGroup.add(needlePivot);

    const needleMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.015, 0.01, 0.62),
      new THREE.MeshStandardMaterial({ color: "#1a1006", roughness: 0.25 })
    );
    needleMesh.position.set(0, 0, -0.28);
    needlePivot.add(needleMesh);

    // Greasy Curved Glass Cover over VU Window
    const greasyRoughMap = createGreasyGlassRoughnessMap();
    const vuGlass = new THREE.Mesh(
      new THREE.BoxGeometry(1.32, 0.015, 0.78),
      new THREE.MeshPhysicalMaterial({
        color: "#fff8eb",
        transparent: true,
        opacity: 0.22,
        roughnessMap: greasyRoughMap,
        roughness: 0.18,
        metalness: 0.05,
        clearcoat: 1.0,
        clearcoatRoughness: 0.12,
      })
    );
    vuGlass.position.y = 0.11;
    vuGroup.add(vuGlass);

    // ================= 8. UPPER-RIGHT 3D KNURLED MASTER VOLUME KNOB =================
    const knobBaseGroup = new THREE.Group();
    knobBaseGroup.position.set(4.02, 0.04, -1.55);
    scene.add(knobBaseGroup);

    const ringPlate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.4, 0.03, 48),
      new THREE.MeshStandardMaterial({ color: "#191b20", metalness: 0.7, roughness: 0.35 })
    );
    knobBaseGroup.add(ringPlate);

    const knobCapGroup = new THREE.Group();
    knobCapGroup.position.y = 0.14;
    knobBaseGroup.add(knobCapGroup);

    const knobBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.27, 0.31, 0.26, 48),
      new THREE.MeshStandardMaterial({
        color: "#cfd4dc",
        metalness: 0.92,
        roughness: 0.2,
      })
    );
    knobBody.castShadow = true;
    knobBody.userData = { action: "volume" };
    knobCapGroup.add(knobBody);
    interactiveObjects.push(knobBody);

    const knobNotch = new THREE.Mesh(
      new THREE.BoxGeometry(0.032, 0.025, 0.18),
      new THREE.MeshStandardMaterial({
        color: "#fff4d6",
        emissive: new THREE.Color("#ffb347"),
        emissiveIntensity: 1.4,
      })
    );
    knobNotch.position.set(0, 0.135, -0.11);
    knobCapGroup.add(knobNotch);

    // ================= RAYCAST CLICK & VOLUME KNOB DRAG =================
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let draggingKnob = false;
    let dragStartY = 0;
    let dragStartVol = volumeRef.current;

    const updatePointer = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (draggingKnob) {
        const deltaY = dragStartY - e.clientY;
        const nextVol = Math.max(0, Math.min(1, dragStartVol + deltaY / 140));
        callbacksRef.current.onChangeVolume(nextVol);
        return;
      }

      updatePointer(e);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(interactiveObjects, false);
      if (hits.length > 0) {
        const act = hits[0].object.userData.action;
        if (act === "trim" && !hasSampleRef.current) {
          renderer.domElement.style.cursor = "default";
        } else if (act === "volume") {
          renderer.domElement.style.cursor = "ns-resize";
        } else {
          renderer.domElement.style.cursor = "pointer";
        }
      } else {
        renderer.domElement.style.cursor = "default";
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      updatePointer(e);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(interactiveObjects, false);
      if (hits.length === 0) return;

      const hitObj = hits[0].object;
      const action = hitObj.userData.action;

      if (hitObj === labelMesh || hitObj === spindle) {
        centerPressBounceRef.current = 1;
        callbacksRef.current.onClickCenterLabel();
      } else if (action === "mode") {
        callbacksRef.current.onSelectMode(hitObj.userData.mode as DigMode);
      } else if (action === "play") {
        callbacksRef.current.onPlay();
      } else if (action === "stop") {
        callbacksRef.current.onStop();
      } else if (action === "trim" && hasSampleRef.current) {
        callbacksRef.current.onOpenTrim();
      } else if (action === "volume") {
        draggingKnob = true;
        dragStartY = e.clientY;
        dragStartVol = volumeRef.current;
      }
    };

    const handlePointerUp = () => {
      draggingKnob = false;
    };

    const handleWheel = (e: WheelEvent) => {
      updatePointer(e as unknown as PointerEvent);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects([knobBody], false);
      if (hits.length > 0) {
        e.preventDefault();
        const step = e.deltaY < 0 ? 0.05 : -0.05;
        callbacksRef.current.onChangeVolume(
          Math.max(0, Math.min(1, volumeRef.current + step))
        );
      }
    };

    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("wheel", handleWheel, { passive: false });

    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
    resizeObserver.observe(container);

    // ================= 60FPS PHYSICS & HARDWARE ANIMATION LOOP =================
    let rafId = 0;
    let angularVel = 0;
    let currentArmYaw = 0.26; // Resting on cradle to the right of disk
    let currentArmPitch = 0.08;

    const animate = () => {
      // 1. Vinyl rotation inertia
      const targetVel = isPlayingRef.current ? 0.048 : 0;
      angularVel += (targetVel - angularVel) * 0.06;
      vinylSpinGroup.rotation.y -= angularVel;
      strobeRing.rotation.y -= angularVel;

      // 2. Tonearm swings LEFT (-0.18 rad) onto vinyl groove when playing, RIGHT (+0.26 rad) to rest when stopped
      const targetYaw = isPlayingRef.current ? -0.18 : 0.26;
      const targetPitch = isPlayingRef.current ? -0.025 : 0.08;
      currentArmYaw += (targetYaw - currentArmYaw) * 0.065;
      currentArmPitch += (targetPitch - currentArmPitch) * 0.08;
      armPivotGroup.rotation.y = currentArmYaw;
      armPivotGroup.rotation.x = currentArmPitch;

      // 3. Center label click depression
      if (centerPressBounceRef.current > 0.001) {
        centerPressBounceRef.current *= 0.84;
        vinylSpinGroup.position.y = 0.082 - centerPressBounceRef.current * 0.028;
      } else {
        vinylSpinGroup.position.y = 0.082;
      }

      // 4. 3D Mode keys physical travel
      modeMeshes.forEach(({ mode, mesh }) => {
        const targetY = activeModeRef.current === mode ? 0.052 : 0.092;
        mesh.position.y += (targetY - mesh.position.y) * 0.18;
      });

      // 5. PLAY & STOP 3D rocker tilt & press
      if (playRockerMesh) {
        const targetY = isPlayingRef.current ? 0.062 : 0.098;
        const targetTilt = isPlayingRef.current ? 0.12 : -0.06;
        playRockerMesh.position.y += (targetY - playRockerMesh.position.y) * 0.18;
        playRockerMesh.rotation.x += (targetTilt - playRockerMesh.rotation.x) * 0.18;
      }
      if (stopRockerMesh) {
        const stopped = !isPlayingRef.current && hasSampleRef.current;
        const targetY = stopped ? 0.062 : 0.098;
        const targetTilt = stopped ? 0.12 : -0.06;
        stopRockerMesh.position.y += (targetY - stopRockerMesh.position.y) * 0.18;
        stopRockerMesh.rotation.x += (targetTilt - stopRockerMesh.rotation.x) * 0.18;
      }

      // 6. TRIM 3D key emerges at bottom-center of disk when track is ready
      const targetTrimY = hasSampleRef.current ? 0.095 : -0.06;
      trimKeyMesh.position.y += (targetTrimY - trimKeyMesh.position.y) * 0.14;

      // 7. 3D Master VU Needle (Only moving line, no LED)
      const clampedVu = Math.max(
        0,
        Math.min(1.15, isPlayingRef.current ? vuLevelRef.current : 0)
      );
      const targetNeedleRot = 0.72 - clampedVu * 1.38;
      needlePivot.rotation.y += (targetNeedleRot - needlePivot.rotation.y) * 0.25;

      // 8. 3D Master Volume Knob rotation
      const targetKnobRot = (0.5 - volumeRef.current) * 4.7;
      knobCapGroup.rotation.y += (targetKnobRot - knobCapGroup.rotation.y) * 0.22;

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("wheel", handleWheel);
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={mountRef} className="fixed inset-0 w-screen h-screen z-0" />;
}