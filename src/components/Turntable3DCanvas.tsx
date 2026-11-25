import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { invoke } from "@tauri-apps/api/core";
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
import {
  createShabbyDeskTextures,
  drawFrontVfdCanvas,
} from "../utils/deskAndVfdTextures";
import {
  createIvoryPianoKeyTexture,
  createTrimFaceplateTexture,
  drawUssrTrimDialCanvas,
} from "../utils/trimDialTextures";
import type { WindowSizePreset } from "./TopBar";
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
  settingsOpen: boolean;
  trimOpen: boolean;
  windowPreset: WindowSizePreset;
  waveformPeaks?: number[];
  sampleDuration?: number;
  trimStart?: number;
  trimEnd?: number;
  playheadProgress?: number;
  isAuditioning?: boolean;
  isExporting?: boolean;
  exportedFilePath?: string | null;
  onChangeWindowPreset: (preset: WindowSizePreset) => void;
  onSelectMode: (mode: DigMode) => void;
  onClickCenterLabel: () => void;
  onPlay: () => void;
  onStop: () => void;
  onOpenTrim: () => void;
  onCloseTrim: () => void;
  onChangeVolume: (val: number) => void;
  onChangeTrimRange?: (start: number, end: number) => void;
  onToggleAudition?: () => void;
  onExportTrim?: () => void;
  onDragExportToDaw?: () => void;
}

interface QueryDictionary {
  generalQueries: string[];
  crateModifiers: string[];
  vocalShortsQueries: string[];
  vocalFullQueries: string[];
  genreKeywords: Record<string, string[]>;
  regionQueries: Record<string, string[]>;
}

type VfdScreenId =
  | "main"
  | "window_size"
  | "generalQueries"
  | "crateModifiers"
  | "vocalFullQueries";

interface VfdRowItem {
  label: string;
  action: () => void;
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

    ctx.save();
    ctx.filter = "blur(13px) brightness(0.8) contrast(1.06) saturate(1.12)";
    ctx.drawImage(img, -28, -28, w + 56, h + 56);
    ctx.restore();

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
  settingsOpen,
  trimOpen,
  windowPreset,
  waveformPeaks = [],
  sampleDuration = 16,
  trimStart = 0,
  trimEnd = 1,
  playheadProgress = 0,
  isAuditioning = false,
  isExporting = false,
  exportedFilePath = null,
  onChangeWindowPreset,
  onSelectMode,
  onClickCenterLabel,
  onPlay,
  onStop,
  onOpenTrim,
  onCloseTrim,
  onChangeVolume,
  onChangeTrimRange,
  onToggleAudition,
  onExportTrim,
  onDragExportToDaw,
}: Turntable3DCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  const [vfdAddingSection, setVfdAddingSection] = useState<
    "generalQueries" | "crateModifiers" | "vocalFullQueries" | null
  >(null);
  const [vfdNewPhrase, setVfdNewPhrase] = useState("");

  // Local fallback trim range when parent does not manage trimStart/trimEnd state directly
  const [localTrim, setLocalTrim] = useState<[number, number]>([trimStart, trimEnd]);
  useEffect(() => {
    setLocalTrim([trimStart, trimEnd]);
  }, [trimStart, trimEnd]);

  const effectiveTrimStart = onChangeTrimRange ? trimStart : localTrim[0];
  const effectiveTrimEnd = onChangeTrimRange ? trimEnd : localTrim[1];

  const isPlayingRef = useRef(isPlaying);
  const isLoadingRef = useRef(isLoading);
  const hasSampleRef = useRef(hasActiveSample);
  const activeModeRef = useRef(activeMode);
  const vuLevelRef = useRef(vuLevel);
  const volumeRef = useRef(masterVolume);
  const settingsOpenRef = useRef(settingsOpen);
  const trimOpenRef = useRef(trimOpen);
  const windowPresetRef = useRef<WindowSizePreset>(windowPreset);

  const trimStartRef = useRef(effectiveTrimStart);
  const trimEndRef = useRef(effectiveTrimEnd);
  const pressedTrimKeyRef = useRef<string | null>(null);

  const labelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelTexRef = useRef<THREE.CanvasTexture | null>(null);
  const modeMaterialsRef = useRef<ModeMaterialMap>(new Map());
  const centerPressBounceRef = useRef(0);

  const trimDialCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const trimDialTexRef = useRef<THREE.CanvasTexture | null>(null);

  const vfdCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const vfdTexRef = useRef<THREE.CanvasTexture | null>(null);
  const dictRef = useRef<QueryDictionary | null>(null);
  const vfdScreenRef = useRef<VfdScreenId>("main");
  const vfdScrollRef = useRef(0);
  const vfdHoverRowRef = useRef(-1);
  const vfdFlashRowRef = useRef(-1);
  const vfdVisibleRowsRef = useRef<VfdRowItem[]>([]);
  const ytdlpStatusRef = useRef<string | null>(null);
  const redrawVfdRef = useRef<(() => void) | null>(null);

  const applyTrimChange = (nextStart: number, nextEnd: number) => {
    const s = Math.max(0, Math.min(0.98, nextStart));
    const e = Math.max(s + 0.02, Math.min(1, nextEnd));
    trimStartRef.current = s;
    trimEndRef.current = e;
    if (onChangeTrimRange) {
      onChangeTrimRange(s, e);
    } else {
      setLocalTrim([s, e]);
    }
  };

  const callbacksRef = useRef({
    onSelectMode,
    onClickCenterLabel,
    onPlay,
    onStop,
    onOpenTrim,
    onCloseTrim,
    onChangeVolume,
    onChangeWindowPreset,
    applyTrimChange,
    onToggleAudition,
    onExportTrim,
  });

  useEffect(() => {
    callbacksRef.current = {
      onSelectMode,
      onClickCenterLabel,
      onPlay,
      onStop,
      onOpenTrim,
      onCloseTrim,
      onChangeVolume,
      onChangeWindowPreset,
      applyTrimChange,
      onToggleAudition,
      onExportTrim,
    };
  });

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

  useEffect(() => {
    trimOpenRef.current = trimOpen;
  }, [trimOpen]);

  useEffect(() => {
    trimStartRef.current = effectiveTrimStart;
    trimEndRef.current = effectiveTrimEnd;
  }, [effectiveTrimStart, effectiveTrimEnd]);

  useEffect(() => {
    windowPresetRef.current = windowPreset;
    redrawVfdRef.current?.();
  }, [windowPreset]);

  // Redraw USSR Radio Trim Dial whenever waveform, trim bounds, or audition state updates
  useEffect(() => {
    if (!trimDialCanvasRef.current || !trimDialTexRef.current) return;
    drawUssrTrimDialCanvas(trimDialCanvasRef.current, {
      title,
      peaks: waveformPeaks,
      durationSec: sampleDuration,
      trimStart: effectiveTrimStart,
      trimEnd: effectiveTrimEnd,
      playhead: playheadProgress,
      isAuditioning,
      isExporting,
    });
    trimDialTexRef.current.needsUpdate = true;
  }, [
    title,
    waveformPeaks,
    sampleDuration,
    effectiveTrimStart,
    effectiveTrimEnd,
    playheadProgress,
    isAuditioning,
    isExporting,
    trimOpen,
  ]);

  // Spacebar auditions loop & Escape exits Trim Mode when Trim Panel is open
  useEffect(() => {
    if (!trimOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        callbacksRef.current.onToggleAudition?.();
      } else if (e.key === "Escape") {
        e.preventDefault();
        callbacksRef.current.onCloseTrim();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [trimOpen]);

  const buildVfdRows = (): VfdRowItem[] => {
    const scr = vfdScreenRef.current;

    if (scr === "main") {
      return [
        {
          label: `> WINDOW SIZE [${windowPresetRef.current.toUpperCase()}]`,
          action: () => {
            vfdScreenRef.current = "window_size";
            vfdScrollRef.current = 0;
          },
        },
        {
          label: `> GENERAL TERMS (${dictRef.current?.generalQueries.length ?? 0})`,
          action: () => {
            vfdScreenRef.current = "generalQueries";
            vfdScrollRef.current = 0;
          },
        },
        {
          label: `> CRATE MODIFIERS (${dictRef.current?.crateModifiers.length ?? 0})`,
          action: () => {
            vfdScreenRef.current = "crateModifiers";
            vfdScrollRef.current = 0;
          },
        },
        {
          label: `> VOCAL TERMS (${dictRef.current?.vocalFullQueries.length ?? 0})`,
          action: () => {
            vfdScreenRef.current = "vocalFullQueries";
            vfdScrollRef.current = 0;
          },
        },
        {
          label: ytdlpStatusRef.current
            ? `> ${ytdlpStatusRef.current}`
            : "> UPDATE YT-DLP ENGINE",
          action: () => {
            ytdlpStatusRef.current = "UPDATING YT-DLP...";
            redrawVfdRef.current?.();
            invoke<string>("update_ytdlp_binary")
              .then((msg) => {
                ytdlpStatusRef.current = msg.slice(0, 28).toUpperCase();
                redrawVfdRef.current?.();
              })
              .catch(() => {
                ytdlpStatusRef.current = "YT-DLP UPDATE FAILED";
                redrawVfdRef.current?.();
              });
          },
        },
      ];
    }

    if (scr === "window_size") {
      const sizes: { id: WindowSizePreset; label: string }[] = [
        { id: "small", label: "SMALL  1100X620" },
        { id: "medium", label: "MEDIUM 1470X770" },
        { id: "big", label: "BIG    1650X930" },
      ];
      return [
        {
          label: "< BACK TO SETTINGS",
          action: () => {
            vfdScreenRef.current = "main";
            vfdScrollRef.current = 0;
          },
        },
        ...sizes.map((s) => ({
          label: `${windowPresetRef.current === s.id ? "[*]" : "[ ]"} ${s.label}`,
          action: () => {
            callbacksRef.current.onChangeWindowPreset(s.id);
          },
        })),
      ];
    }

    const terms = dictRef.current?.[scr] ?? [];
    return [
      {
        label: "< BACK TO SETTINGS",
        action: () => {
          setVfdAddingSection(null);
          vfdScreenRef.current = "main";
          vfdScrollRef.current = 0;
        },
      },
      {
        label: "+ ADD NEW PHRASE",
        action: () => {
          setVfdNewPhrase("");
          setVfdAddingSection(scr);
        },
      },
      ...terms.map((word) => ({
        label: `  ${word.padEnd(23, " ").slice(0, 23)} [X]`,
        action: () => {
          if (!dictRef.current || dictRef.current[scr].length <= 1) return;
          const updated: QueryDictionary = {
            ...dictRef.current,
            [scr]: dictRef.current[scr].filter((w) => w !== word),
          };
          dictRef.current = updated;
          invoke("save_query_dictionary", { dict: updated }).catch(console.error);
        },
      })),
    ];
  };

  redrawVfdRef.current = () => {
    const canvas = vfdCanvasRef.current;
    const tex = vfdTexRef.current;
    if (!canvas || !tex) return;

    if (!settingsOpenRef.current) {
      const line2 = isLoadingRef.current
        ? "DIGGING CRATE..."
        : isPlayingRef.current
        ? "33.3 RPM  PLAYING"
        : "33.3 RPM  READY";
      drawFrontVfdCanvas(canvas, ["CRATEWAVE CU16025", line2], { cols: 18 });
      tex.needsUpdate = true;
      return;
    }

    const allRows = buildVfdRows();
    const maxScroll = Math.max(0, allRows.length - 4);
    vfdScrollRef.current = Math.max(0, Math.min(vfdScrollRef.current, maxScroll));

    const visible = allRows.slice(vfdScrollRef.current, vfdScrollRef.current + 4);
    vfdVisibleRowsRef.current = visible;

    const formattedLines = Array.from({ length: 4 }, (_, idx) => {
      const item = visible[idx];
      if (!item) return "";
      const scrollIndicator =
        idx === 0 && vfdScrollRef.current > 0
          ? "^"
          : idx === 3 && vfdScrollRef.current + 4 < allRows.length
          ? "v"
          : " ";
      return item.label.padEnd(31, " ").slice(0, 31) + scrollIndicator;
    });

    drawFrontVfdCanvas(canvas, formattedLines, {
      hoverRow: vfdHoverRowRef.current,
      flashRow: vfdFlashRowRef.current,
      cols: 32,
    });
    tex.needsUpdate = true;
  };

  useEffect(() => {
    settingsOpenRef.current = settingsOpen;
    if (settingsOpen) {
      vfdScreenRef.current = "main";
      vfdScrollRef.current = 0;
      vfdHoverRowRef.current = -1;
      vfdFlashRowRef.current = -1;
      setVfdAddingSection(null);
      invoke<QueryDictionary>("get_query_dictionary")
        .then((d) => {
          dictRef.current = d;
          redrawVfdRef.current?.();
        })
        .catch(console.error);
    } else {
      setVfdAddingSection(null);
    }
    redrawVfdRef.current?.();
  }, [settingsOpen, isPlaying, isLoading]);

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
    scene.background = createStudioRoomTexture();
    loadBlurredStudioPhoto((photoTex) => {
      scene.background = photoTex;
    });

    const width = container.clientWidth || 1280;
    const height = container.clientHeight || 720;

    // Camera Presets:
    // 1. Main angled studio view
    const topCamPos = new THREE.Vector3(0, 9.75, 4.15);
    const topCamLook = new THREE.Vector3(0, -0.05, 0.05);

    // 2. Front VFD settings view
    const frontCamPos = new THREE.Vector3(0, -0.22, 9.65);
    const frontCamLook = new THREE.Vector3(0, -0.34, 2.65);

   // 3. USSR Radio Trim Panel view: 0° parallel straight-down zoom (~80% panel fill,
    //    showing main board corners & the edge of the hinged acrylic cover at the top)
    const trimPanelCenterX = 2.92;
    const trimPanelCenterZ = 1.81;
    const trimCamPos = new THREE.Vector3(trimPanelCenterX, 3.55, trimPanelCenterZ + 0.0001);
    const trimCamLook = new THREE.Vector3(trimPanelCenterX, 0.05, trimPanelCenterZ);

    const camPosCurrent = topCamPos.clone();
    const camLookCurrent = topCamLook.clone();

    const camera = new THREE.PerspectiveCamera(31, width / height, 0.1, 60);
    camera.position.copy(camPosCurrent);
    camera.lookAt(camLookCurrent);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.96;
    container.appendChild(renderer.domElement);

    // Soft Warm Studio Reflection Map
    const envCanvas = document.createElement("canvas");
    envCanvas.width = 256;
    envCanvas.height = 128;
    const envCtx = envCanvas.getContext("2d")!;
    const envGrad = envCtx.createLinearGradient(0, 0, 0, 128);
    envGrad.addColorStop(0, "#5a4026");
    envGrad.addColorStop(0.5, "#302014");
    envGrad.addColorStop(1, "#170f09");
    envCtx.fillStyle = envGrad;
    envCtx.fillRect(0, 0, 256, 128);

    const softBandLeft = envCtx.createRadialGradient(64, 30, 6, 64, 30, 56);
    softBandLeft.addColorStop(0, "rgba(255, 224, 178, 0.30)");
    softBandLeft.addColorStop(1, "rgba(255, 224, 178, 0)");
    envCtx.fillStyle = softBandLeft;
    envCtx.fillRect(0, 0, 128, 72);

    const softBandRight = envCtx.createRadialGradient(192, 30, 6, 192, 30, 56);
    softBandRight.addColorStop(0, "rgba(255, 224, 178, 0.30)");
    softBandRight.addColorStop(1, "rgba(255, 224, 178, 0)");
    envCtx.fillStyle = softBandRight;
    envCtx.fillRect(128, 0, 128, 72);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const rawEnvTex = new THREE.CanvasTexture(envCanvas);
    rawEnvTex.mapping = THREE.EquirectangularReflectionMapping;
    rawEnvTex.colorSpace = THREE.SRGBColorSpace;
    const studioEnvRT = pmremGenerator.fromEquirectangular(rawEnvTex);
    scene.environment = studioEnvRT.texture;
    rawEnvTex.dispose();
    pmremGenerator.dispose();

    // Moody Warm Analog Studio Lighting
    const hemiLight = new THREE.HemisphereLight("#ffe4be", "#24160e", 0.2);
    scene.add(hemiLight);

    const leftDeckLamp = new THREE.PointLight("#ffdfb3", 4.6, 36, 0.55);
    leftDeckLamp.position.set(-5.4, 10.8, -5.2);
    scene.add(leftDeckLamp);

    const keyLight = new THREE.DirectionalLight("#ffdfb3", 1.75);
    keyLight.position.set(5.6, 10.6, -5.0);
    keyLight.target.position.set(0.2, 0, 0.1);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -5.4;
    keyLight.shadow.camera.right = 5.4;
    keyLight.shadow.camera.top = 4.2;
    keyLight.shadow.camera.bottom = -4.2;
    keyLight.shadow.camera.near = 4.0;
    keyLight.shadow.camera.far = 22.0;
    keyLight.shadow.bias = -0.00015;
    keyLight.shadow.normalBias = 0.018;
    scene.add(keyLight);
    scene.add(keyLight.target);

    const bottomDeckFill = new THREE.PointLight("#ffebd2", 1.85, 32, 0.55);
    bottomDeckFill.position.set(-0.4, 10.5, 5.2);
    scene.add(bottomDeckFill);

    // Two +-45 degree warm studio fill lights for Front VFD Settings mode
    const frontLeftWarmLight = new THREE.PointLight("#ffebd2", 0, 22, 1.35);
    frontLeftWarmLight.position.set(-6.2, 1.35, 8.85);
    scene.add(frontLeftWarmLight);

    const frontRightWarmLight = new THREE.PointLight("#ffebd2", 0, 22, 1.35);
    frontRightWarmLight.position.set(6.2, 1.35, 8.85);
    scene.add(frontRightWarmLight);

    // ================= 1. SHABBY WOODEN DESK, ISOLATION FEET & CHASSIS =================
    const deskTex = createShabbyDeskTextures();
    const deskMesh = new THREE.Mesh(
      new THREE.BoxGeometry(36, 0.6, 26),
      new THREE.MeshStandardMaterial({
        map: deskTex.map,
        bumpMap: deskTex.bumpMap,
        bumpScale: 0.025,
        roughnessMap: deskTex.roughnessMap,
        roughness: 0.78,
        metalness: 0.04,
      })
    );
    deskMesh.position.set(0, -1.06, -3.5);
    deskMesh.receiveShadow = true;
    scene.add(deskMesh);

    const chassisTex = createWarmChassisTextures();
    const plinthMat = new THREE.MeshStandardMaterial({
      map: chassisTex.map,
      bumpMap: chassisTex.bumpMap,
      bumpScale: 0.018,
      metalness: 0.62,
      roughness: 0.42,
      envMapIntensity: 0.24,
    });
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(8.9, 0.56, 5.2), plinthMat);
    plinth.position.set(0, -0.28, 0.05);
    plinth.receiveShadow = true;
    plinth.castShadow = true;
    scene.add(plinth);

    const walnutMat = new THREE.MeshStandardMaterial({
      map: createWalnutWoodTexture(),
      roughness: 0.42,
      metalness: 0.08,
    });
    const leftWood = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.62, 5.3), walnutMat);
    leftWood.position.set(-4.56, -0.26, 0.05);
    leftWood.castShadow = true;
    leftWood.receiveShadow = true;
    scene.add(leftWood);

    const rightWood = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.62, 5.3), walnutMat);
    rightWood.position.set(4.56, -0.26, 0.05);
    rightWood.castShadow = true;
    rightWood.receiveShadow = true;
    scene.add(rightWood);

    const chromeMat = new THREE.MeshStandardMaterial({
      color: "#e6eaf0",
      metalness: 0.95,
      roughness: 0.14,
    });

    // 4 Shock-Absorbing Isolation Legs
    const rubberMat = new THREE.MeshStandardMaterial({
      color: "#17181c",
      roughness: 0.82,
      metalness: 0.12,
    });
    [
      [-3.85, -1.95],
      [3.85, -1.95],
      [-3.85, 2.05],
      [3.85, 2.05],
    ].forEach(([fx, fz]) => {
      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.27, 0.1, 32),
        chromeMat
      );
      collar.position.set(fx, -0.61, fz);
      collar.castShadow = true;
      scene.add(collar);

      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(0.27, 0.24, 0.1, 32),
        rubberMat
      );
      pad.position.set(fx, -0.71, fz);
      pad.castShadow = true;
      pad.receiveShadow = true;
      scene.add(pad);
    });

    // 4 Corner Slotted Chassis Screws
    const screwGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.03, 20);
    [
      [-4.22, -2.35],
      [4.22, -2.35],
      [-4.22, 2.45],
      [4.32, 2.50],
    ].forEach(([sx, sz]) => {
      const screw = new THREE.Mesh(screwGeo, chromeMat);
      screw.position.set(sx, 0.015, sz);
      scene.add(screw);
    });

    // ================= 2. 3D STEPPED PLATTER & SPINNING VINYL =================
    const platterCenterX = -0.24;
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

    // ================= 3. ARTICULATED 3D CHROME TONEARM =================
    const tonearmBaseGroup = new THREE.Group();
    tonearmBaseGroup.position.set(2.24, 0.06, -1.25);
    scene.add(tonearmBaseGroup);

    const gimbalBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.38, 0.18, 48),
      platterMat
    );
    gimbalBase.castShadow = true;
    tonearmBaseGroup.add(gimbalBase);

    const restPost = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.045, 0.16, 16),
      chromeMat
    );
    restPost.position.set(1.98, 0.08, 0.46);
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

    // ================= 5. PLAY & STOP PIANO-KEY ROCKERS =================
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

    // ================= 6. BOTTOM-CENTER 3D TRIM KEY =================
    const trimSlot = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.07, 0.44), bezelMat);
    trimSlot.position.set(platterCenterX, 0.03, 2.08);
    trimSlot.receiveShadow = true;
    scene.add(trimSlot);

    const trimTexSet = createRealisticKeyTextures("✂ TRIM", "", true, true);
    const trimTopMat = new THREE.MeshStandardMaterial({
      map: trimTexSet.map,
      bumpMap: trimTexSet.bumpMap,
      bumpScale: 0.012,
      metalness: 0.72,
      roughness: 0.24,
      color: new THREE.Color("#6e6a63"),
      emissive: new THREE.Color("#ffae42"),
      emissiveIntensity: 0,
    });
    const trimKeyMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.16, 0.16, 0.36),
      [metalSideMat, metalSideMat, trimTopMat, metalSideMat, metalSideMat, metalSideMat]
    );
    trimKeyMesh.position.set(platterCenterX, -0.008, 2.08);
    trimKeyMesh.castShadow = true;
    trimKeyMesh.receiveShadow = true;
    trimKeyMesh.userData = { action: "trim" };
    scene.add(trimKeyMesh);
    interactiveObjects.push(trimKeyMesh);

    // ================= 7. UPPER-RIGHT 3D MASTER VU METER =================
    const vuGroup = new THREE.Group();
    vuGroup.position.set(3.52, 0.04, -1.34);
    vuGroup.rotation.x = 0.14;
    scene.add(vuGroup);

    const housingMat = new THREE.MeshStandardMaterial({
      color: "#22242a",
      metalness: 0.86,
      roughness: 0.24,
    });

    const vuFloor = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.04, 0.94), housingMat);
    vuFloor.position.y = 0.01;
    vuGroup.add(vuFloor);

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

    const vuDialTex = createVuDialTexture();
    const vuDial = new THREE.Mesh(
      new THREE.PlaneGeometry(1.32, 0.78),
      new THREE.MeshStandardMaterial({
        map: vuDialTex,
        emissive: new THREE.Color("#ffb347"),
        emissiveMap: vuDialTex,
        emissiveIntensity: 0.32,
        roughness: 0.58,
      })
    );
    vuDial.rotation.x = -Math.PI / 2;
    vuDial.position.y = 0.04;
    vuGroup.add(vuDial);

    const needlePivot = new THREE.Group();
    needlePivot.position.set(0, 0.062, 0.34);
    vuGroup.add(needlePivot);

    const needleMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.015, 0.01, 0.62),
      new THREE.MeshStandardMaterial({ color: "#1a1006", roughness: 0.25 })
    );
    needleMesh.position.set(0, 0, -0.28);
    needlePivot.add(needleMesh);

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
    knobBaseGroup.position.set(3.52, 0.02, -0.22);
    scene.add(knobBaseGroup);

    const scratchW = 768;
    const scratchH = 480;
    const pColorCanvas = document.createElement("canvas");
    pColorCanvas.width = scratchW;
    pColorCanvas.height = scratchH;
    const pcCtx = pColorCanvas.getContext("2d")!;
    pcCtx.fillStyle = "#22242a";
    pcCtx.fillRect(0, 0, scratchW, scratchH);

    const pBumpCanvas = document.createElement("canvas");
    pBumpCanvas.width = scratchW;
    pBumpCanvas.height = scratchH;
    const pbCtx = pBumpCanvas.getContext("2d")!;
    pbCtx.fillStyle = "#808080";
    pbCtx.fillRect(0, 0, scratchW, scratchH);

    const pRoughCanvas = document.createElement("canvas");
    pRoughCanvas.width = scratchW;
    pRoughCanvas.height = scratchH;
    const prCtx = pRoughCanvas.getContext("2d")!;
    prCtx.fillStyle = "#383838";
    prCtx.fillRect(0, 0, scratchW, scratchH);

    const drawMicroScratch = (
      ctx: CanvasRenderingContext2D,
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      midWidth: number,
      style: string
    ) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * (midWidth * 0.5);
      const ny = (dx / len) * (midWidth * 0.5);
      const mx = (x1 + x2) * 0.5;
      const my = (y1 + y2) * 0.5;

      ctx.fillStyle = style;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(mx + nx, my + ny, x2, y2);
      ctx.quadraticCurveTo(mx - nx, my - ny, x1, y1);
      ctx.closePath();
      ctx.fill();
    };

    for (let i = 0; i < 15; i++) {
      const x1 = ((i * 211 + 47) % (scratchW - 60)) + 30;
      const y1 = ((i * 139 + 29) % (scratchH - 60)) + 30;
      const angle = ((i * 83 + 17) % 360) * (Math.PI / 180);
      const len = 14 + ((i * 23) % 34);
      const x2 = x1 + Math.cos(angle) * len;
      const y2 = y1 + Math.sin(angle) * len;
      const thickness = 0.65 + (i % 4) * 0.22;

      drawMicroScratch(
        pcCtx,
        x1,
        y1,
        x2,
        y2,
        thickness,
        i % 2 === 0 ? "rgba(68, 73, 84, 0.42)" : "rgba(52, 56, 64, 0.35)"
      );
      drawMicroScratch(pbCtx, x1, y1, x2, y2, thickness, "#424242");
      drawMicroScratch(prCtx, x1, y1, x2, y2, thickness * 1.15, "#a6a6a6");
    }

    const plateColorTex = new THREE.CanvasTexture(pColorCanvas);
    plateColorTex.colorSpace = THREE.SRGBColorSpace;
    const plateBumpTex = new THREE.CanvasTexture(pBumpCanvas);
    const plateRoughTex = new THREE.CanvasTexture(pRoughCanvas);

    const knobPlateMat = new THREE.MeshPhysicalMaterial({
      map: plateColorTex,
      bumpMap: plateBumpTex,
      bumpScale: 0.008,
      roughnessMap: plateRoughTex,
      roughness: 1.0,
      metalness: 0.88,
      clearcoat: 0.82,
      clearcoatRoughness: 0.16,
    });
    const knobMountPlate = new THREE.Mesh(
      new THREE.BoxGeometry(1.48, 0.06, 0.94),
      knobPlateMat
    );
    knobMountPlate.position.y = 0.02;
    knobMountPlate.castShadow = true;
    knobMountPlate.receiveShadow = true;
    knobBaseGroup.add(knobMountPlate);

    const knobPlateRim = new THREE.Mesh(
      new THREE.BoxGeometry(1.42, 0.02, 0.88),
      new THREE.MeshPhysicalMaterial({
        map: plateColorTex,
        bumpMap: plateBumpTex,
        bumpScale: 0.008,
        roughnessMap: plateRoughTex,
        roughness: 0.95,
        metalness: 0.92,
        clearcoat: 1.0,
        clearcoatRoughness: 0.12,
      })
    );
    knobPlateRim.position.y = 0.052;
    knobPlateRim.receiveShadow = true;
    knobBaseGroup.add(knobPlateRim);

    const ringPlate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.4, 0.03, 48),
      new THREE.MeshStandardMaterial({ color: "#191b20", metalness: 0.78, roughness: 0.28 })
    );
    ringPlate.position.y = 0.07;
    knobBaseGroup.add(ringPlate);

    const knobCapGroup = new THREE.Group();
    knobCapGroup.position.y = 0.2;
    knobBaseGroup.add(knobCapGroup);

    const knobBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.27, 0.31, 0.26, 48),
      new THREE.MeshStandardMaterial({
        color: "#8c939e",
        metalness: 0.84,
        roughness: 0.38,
        envMapIntensity: 0.24,
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

   // ================= 9. BOTTOM-RIGHT 3D USSR RADIO TRIM PANEL & HINGED ACRYLIC COVER =================
    const trimInteractiveObjects: THREE.Object3D[] = [];
    const trimPanelGroup = new THREE.Group();
    trimPanelGroup.position.set(trimPanelCenterX, 0.01, trimPanelCenterZ);
    scene.add(trimPanelGroup);

    const panelW = 2.84;
    const panelD = 1.42;

    // Outer anodized chassis frame
    const trimFrameMesh = new THREE.Mesh(
      new THREE.BoxGeometry(panelW, 0.05, panelD),
      new THREE.MeshStandardMaterial({
        color: "#1c1e23",
        metalness: 0.84,
        roughness: 0.28,
      })
    );
    trimFrameMesh.position.y = 0.015;
    trimFrameMesh.castShadow = true;
    trimFrameMesh.receiveShadow = true;
    trimPanelGroup.add(trimFrameMesh);

    // Soviet pinstripe faceplate
    const trimFaceTex = createTrimFaceplateTexture();
    const trimFaceMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(panelW - 0.08, panelD - 0.08),
      new THREE.MeshStandardMaterial({
        map: trimFaceTex,
        roughness: 0.42,
        metalness: 0.25,
      })
    );
    trimFaceMesh.rotation.x = -Math.PI / 2;
    trimFaceMesh.position.y = 0.042;
    trimFaceMesh.receiveShadow = true;
    trimPanelGroup.add(trimFaceMesh);

    // 4 Corner Slotted Screws on the Trim Panel
    [
      [-panelW * 0.5 + 0.08, -panelD * 0.5 + 0.08],
      [panelW * 0.5 - 0.08, -panelD * 0.5 + 0.08],
      [-panelW * 0.5 + 0.08, panelD * 0.5 - 0.08],
      [panelW * 0.5 - 0.08, panelD * 0.5 - 0.08],
    ].forEach(([sx, sz]) => {
      const sMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.028, 0.028, 0.02, 16),
        chromeMat
      );
      sMesh.position.set(sx, 0.046, sz);
      trimPanelGroup.add(sMesh);
    });

    // Center USSR Radio Glass Dial + Live Waveform (wide Soviet radiola scale)
    const dialW = 1.72;
    const dialD = 0.78;
    const dialZ = -0.16;

    const dialBezel = new THREE.Mesh(
      new THREE.BoxGeometry(dialW + 0.07, 0.035, dialD + 0.07),
      new THREE.MeshStandardMaterial({
        color: "#cbb898",
        metalness: 0.55,
        roughness: 0.32,
      })
    );
    dialBezel.position.set(0, 0.046, dialZ);
    trimPanelGroup.add(dialBezel);

    const trimDialCanvas = document.createElement("canvas");
    trimDialCanvas.width = 1024;
    trimDialCanvas.height = 608;
    drawUssrTrimDialCanvas(trimDialCanvas, {
      title,
      peaks: waveformPeaks,
      durationSec: sampleDuration,
      trimStart: effectiveTrimStart,
      trimEnd: effectiveTrimEnd,
      playhead: playheadProgress,
      isAuditioning,
      isExporting,
    });
    trimDialCanvasRef.current = trimDialCanvas;

    const trimDialTex = new THREE.CanvasTexture(trimDialCanvas);
    trimDialTex.colorSpace = THREE.SRGBColorSpace;
    trimDialTex.anisotropy = 8;
    trimDialTexRef.current = trimDialTex;

    const trimDialScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(dialW, dialD),
      new THREE.MeshStandardMaterial({
        map: trimDialTex,
        emissive: new THREE.Color("#ffb648"),
        emissiveMap: trimDialTex,
        emissiveIntensity: 0.52,
        roughness: 0.35,
      })
    );
    trimDialScreen.rotation.x = -Math.PI / 2;
    trimDialScreen.position.set(0, 0.065, dialZ);
    trimDialScreen.userData = { trimAction: "dial" };
    trimPanelGroup.add(trimDialScreen);
    trimInteractiveObjects.push(trimDialScreen);

    // Thin clear glass pane over the radio scale
    const trimDialGlass = new THREE.Mesh(
      new THREE.BoxGeometry(dialW, 0.01, dialD),
      new THREE.MeshPhysicalMaterial({
        color: "#fff7e8",
        transparent: true,
        opacity: 0.12,
        roughness: 0.14,
        metalness: 0.05,
        clearcoat: 0.9,
      })
    );
    trimDialGlass.position.set(0, 0.072, dialZ);
    trimPanelGroup.add(trimDialGlass);

    // Left & Right Cream/Ivory Soviet Rotary Tuning Knobs (IN & OUT)
    const ivoryMat = new THREE.MeshStandardMaterial({
      color: "#efe4ce",
      roughness: 0.34,
      metalness: 0.08,
    });
    const brassCapMat = new THREE.MeshStandardMaterial({
      color: "#d9b46c",
      metalness: 0.82,
      roughness: 0.24,
    });
    const notchMat = new THREE.MeshStandardMaterial({
      color: "#2a1e12",
      roughness: 0.4,
    });

    const createSovietKnob = (xPos: number, actionId: "trim_in_knob" | "trim_out_knob") => {
      const kGroup = new THREE.Group();
      kGroup.position.set(xPos, 0.045, -0.2);
      trimPanelGroup.add(kGroup);

      const skirt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.175, 0.045, 40),
        ivoryMat
      );
      skirt.position.y = 0.022;
      skirt.castShadow = true;
      skirt.userData = { trimAction: actionId };
      kGroup.add(skirt);
      trimInteractiveObjects.push(skirt);

      const upperGrip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.105, 0.12, 0.08, 36),
        ivoryMat
      );
      upperGrip.position.y = 0.076;
      upperGrip.castShadow = true;
      upperGrip.userData = { trimAction: actionId };
      kGroup.add(upperGrip);
      trimInteractiveObjects.push(upperGrip);

      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.062, 0.062, 0.014, 28),
        brassCapMat
      );
      cap.position.y = 0.118;
      kGroup.add(cap);

      const indicator = new THREE.Mesh(
        new THREE.BoxGeometry(0.014, 0.016, 0.075),
        notchMat
      );
      indicator.position.set(0, 0.12, -0.054);
      kGroup.add(indicator);

      return kGroup;
    };

    const inKnobGroup = createSovietKnob(-1.12, "trim_in_knob");
    const outKnobGroup = createSovietKnob(1.12, "trim_out_knob");

    // Bottom Row of 4 Cream/Ivory Soviet Radio Piano Keys
    const pianoKeyDefs = [
      { id: "trim_back", label: "← BACK", sub: "DECK", x: -0.99, width: 0.61, active: false },
      { id: "trim_audition", label: "▷ LOOP", sub: "SPACE", x: -0.33, width: 0.65, active: false },
      { id: "trim_reset", label: "↺ FULL", sub: "RESET", x: 0.33, width: 0.61, active: false },
      { id: "trim_export", label: "✂ SLICE", sub: "EXPORT", x: 0.99, width: 0.65, active: true },
    ];

    const pianoKeyMeshes: { id: string; mesh: THREE.Mesh }[] = [];
    const pianoKeyZ = 0.47;

    const pianoWell = new THREE.Mesh(
      new THREE.BoxGeometry(2.68, 0.03, 0.31),
      new THREE.MeshStandardMaterial({ color: "#0b0c0f", roughness: 0.8 })
    );
    pianoWell.position.set(0, 0.044, pianoKeyZ);
    trimPanelGroup.add(pianoWell);

    pianoKeyDefs.forEach((pk) => {
      const topTex = createIvoryPianoKeyTexture(pk.label, pk.sub, "#261b10", pk.active);
      const topMat = new THREE.MeshStandardMaterial({
        map: topTex,
        roughness: 0.32,
        metalness: 0.06,
      });
      const sideMat = new THREE.MeshStandardMaterial({
        color: "#cfc0a3",
        roughness: 0.45,
      });

      const keyMesh = new THREE.Mesh(
        new THREE.BoxGeometry(pk.width, 0.08, 0.25),
        [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]
      );
      keyMesh.position.set(pk.x, 0.078, pianoKeyZ);
      keyMesh.castShadow = true;
      keyMesh.receiveShadow = true;
      keyMesh.userData = { trimAction: pk.id };
      trimPanelGroup.add(keyMesh);

      trimInteractiveObjects.push(keyMesh);
      pianoKeyMeshes.push({ id: pk.id, mesh: keyMesh });
    });

    // ================= 9B. HINGED SMOKY ACRYLIC DUST COVER (ВЕГА-STYLE) =================
    const coverHingeZ = trimPanelCenterZ - panelD * 0.5 - 0.02;
    const trimCoverHingeGroup = new THREE.Group();
    trimCoverHingeGroup.position.set(trimPanelCenterX, 0.15, coverHingeZ);
    scene.add(trimCoverHingeGroup);

    [-1.04, 1.04].forEach((hx) => {
      const hingeBracket = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.055, 0.075),
        chromeMat
      );
      hingeBracket.position.set(hx, -0.04, 0.01);
      hingeBracket.castShadow = true;
      trimCoverHingeGroup.add(hingeBracket);
    });

    const acrylicMat = new THREE.MeshPhysicalMaterial({
      color: "#383028",
      transparent: true,
      opacity: 0.36,
      roughness: 0.14,
      metalness: 0.05,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
      depthWrite: false,
    });

    const coverW = panelW + 0.05;
    const coverD = panelD + 0.05;
    const coverH = 0.16;
    const wallT = 0.016;

    const rearRoof = new THREE.Mesh(
      new THREE.BoxGeometry(coverW, wallT, coverD * 0.42),
      acrylicMat
    );
    rearRoof.position.set(0, 0.045, coverD * 0.21);
    trimCoverHingeGroup.add(rearRoof);

    const stepSlope = new THREE.Mesh(
      new THREE.BoxGeometry(coverW, wallT, 0.12),
      acrylicMat
    );
    stepSlope.position.set(0, 0.022, coverD * 0.44);
    stepSlope.rotation.x = 0.36;
    trimCoverHingeGroup.add(stepSlope);

    const frontRoof = new THREE.Mesh(
      new THREE.BoxGeometry(coverW, wallT, coverD * 0.54),
      acrylicMat
    );
    frontRoof.position.set(0, 0.0, coverD * 0.73);
    frontRoof.userData = { action: "trim" };
    trimCoverHingeGroup.add(frontRoof);
    interactiveObjects.push(frontRoof);

    const backWall = new THREE.Mesh(
      new THREE.BoxGeometry(coverW, coverH + 0.045, wallT),
      acrylicMat
    );
    backWall.position.set(0, -0.05, 0.01);
    trimCoverHingeGroup.add(backWall);

    const frontWall = new THREE.Mesh(
      new THREE.BoxGeometry(coverW, coverH, wallT),
      acrylicMat
    );
    frontWall.position.set(0, -0.072, coverD);
    trimCoverHingeGroup.add(frontWall);

    const leftWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallT, coverH, coverD),
      acrylicMat
    );
    leftWall.position.set(-coverW * 0.5 + wallT * 0.5, -0.072, coverD * 0.5);
    trimCoverHingeGroup.add(leftWall);

    const rightWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallT, coverH, coverD),
      acrylicMat
    );
    rightWall.position.set(coverW * 0.5 - wallT * 0.5, -0.072, coverD * 0.5);
    trimCoverHingeGroup.add(rightWall);

    
    // ================= 10. FRONT PANEL VACUUM FLUORESCENT DISPLAY (VFD) =================
    const frontZ = 2.65;
    const vfdBezel = new THREE.Mesh(
      new THREE.BoxGeometry(5.44, 0.48, 0.06),
      new THREE.MeshStandardMaterial({
        color: "#14161a",
        metalness: 0.85,
        roughness: 0.25,
      })
    );
    vfdBezel.position.set(0, -0.28, frontZ + 0.01);
    scene.add(vfdBezel);

    const vfdCanvas = document.createElement("canvas");
    vfdCanvas.width = 1200;
    vfdCanvas.height = 220;
    vfdCanvasRef.current = vfdCanvas;

    const vfdTex = new THREE.CanvasTexture(vfdCanvas);
    vfdTex.colorSpace = THREE.SRGBColorSpace;
    vfdTex.anisotropy = 8;
    vfdTexRef.current = vfdTex;

    const vfdScreenMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 0.42),
      new THREE.MeshStandardMaterial({
        map: vfdTex,
        emissive: new THREE.Color("#4fffe0"),
        emissiveMap: vfdTex,
        emissiveIntensity: 0.95,
        roughness: 0.3,
      })
    );
    vfdScreenMesh.position.set(0, -0.28, frontZ + 0.042);
    scene.add(vfdScreenMesh);

    redrawVfdRef.current?.();

    const vfdGlass = new THREE.Mesh(
      new THREE.BoxGeometry(5.26, 0.44, 0.014),
      new THREE.MeshPhysicalMaterial({
        color: "#dffcf5",
        transparent: true,
        opacity: 0.08,
        roughness: 0.14,
        metalness: 0.05,
        clearcoat: 0.85,
      })
    );
    vfdGlass.position.set(0, -0.28, frontZ + 0.052);
    scene.add(vfdGlass);

    const powerButton = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.22, 0.12),
      new THREE.MeshStandardMaterial({ color: "#23262e", metalness: 0.8, roughness: 0.25 })
    );
    powerButton.position.set(-3.75, -0.28, frontZ + 0.03);
    scene.add(powerButton);

    const powerLed = new THREE.Mesh(
      new THREE.SphereGeometry(0.032, 16, 16),
      new THREE.MeshStandardMaterial({
        color: "#ffbe55",
        emissive: new THREE.Color("#ff9900"),
        emissiveIntensity: 2.2,
      })
    );
    powerLed.position.set(-3.32, -0.28, frontZ + 0.02);
    scene.add(powerLed);

    const phoneJackRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.06, 24),
      chromeMat
    );
    phoneJackRing.rotation.x = Math.PI / 2;
    phoneJackRing.position.set(3.75, -0.28, frontZ + 0.015);
    scene.add(phoneJackRing);

    const phoneJackHole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.065, 0.07, 20),
      new THREE.MeshBasicMaterial({ color: "#07080a" })
    );
    phoneJackHole.rotation.x = Math.PI / 2;
    phoneJackHole.position.set(3.75, -0.28, frontZ + 0.02);
    scene.add(phoneJackHole);

    // ================= RAYCAST INTERACTION (MAIN DECK, VFD & TRIM PANEL) =================
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let draggingKnob = false;
    let dragStartY = 0;
    let dragStartVol = volumeRef.current;

    let trimDragMode: "in_knob" | "out_knob" | "dial_in" | "dial_out" | null = null;
    let trimDragStartY = 0;
    let trimDragStartVal = 0;

    const updatePointer = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const uvToNormalizedPlotX = (u: number) => {
      // Matches plotLeft = 78 / 1024 (~0.076) and plotRight = 976 / 1024 (~0.953)
      return Math.max(0, Math.min(1, (u - 0.076) / (0.953 - 0.076)));
    };

    const handlePointerMove = (e: PointerEvent) => {
      // 1. Trim Panel Active Mode
      if (trimOpenRef.current) {
        updatePointer(e);
        raycaster.setFromCamera(pointer, camera);

        if (trimDragMode === "in_knob") {
          const delta = (trimDragStartY - e.clientY) / 180;
          callbacksRef.current.applyTrimChange(
            trimDragStartVal + delta,
            trimEndRef.current
          );
          return;
        }
        if (trimDragMode === "out_knob") {
          const delta = (trimDragStartY - e.clientY) / 180;
          callbacksRef.current.applyTrimChange(
            trimStartRef.current,
            trimDragStartVal + delta
          );
          return;
        }
        if (trimDragMode === "dial_in" || trimDragMode === "dial_out") {
          const dialHits = raycaster.intersectObject(trimDialScreen, false);
          if (dialHits.length > 0 && dialHits[0].uv) {
            const normX = uvToNormalizedPlotX(dialHits[0].uv.x);
            if (trimDragMode === "dial_in") {
              callbacksRef.current.applyTrimChange(normX, trimEndRef.current);
            } else {
              callbacksRef.current.applyTrimChange(trimStartRef.current, normX);
            }
          }
          return;
        }

        const hits = raycaster.intersectObjects(trimInteractiveObjects, false);
        if (hits.length > 0) {
          const act = hits[0].object.userData.trimAction;
          if (act === "trim_in_knob" || act === "trim_out_knob") {
            renderer.domElement.style.cursor = "ns-resize";
          } else if (act === "dial") {
            renderer.domElement.style.cursor = "ew-resize";
          } else {
            renderer.domElement.style.cursor = "pointer";
          }
        } else {
          renderer.domElement.style.cursor = "default";
        }
        return;
      }

      // 2. Front VFD Settings Mode
      if (settingsOpenRef.current) {
        updatePointer(e);
        raycaster.setFromCamera(pointer, camera);
        const vfdHits = raycaster.intersectObject(vfdScreenMesh, false);
        if (vfdHits.length > 0 && vfdHits[0].uv) {
          const row = Math.min(3, Math.max(0, Math.floor((1 - vfdHits[0].uv.y) * 4)));
          if (row < vfdVisibleRowsRef.current.length) {
            renderer.domElement.style.cursor = "pointer";
            if (vfdHoverRowRef.current !== row) {
              vfdHoverRowRef.current = row;
              redrawVfdRef.current?.();
            }
            return;
          }
        }
        if (vfdHoverRowRef.current !== -1) {
          vfdHoverRowRef.current = -1;
          redrawVfdRef.current?.();
        }
        renderer.domElement.style.cursor = "default";
        return;
      }

      // 3. Main Turntable View
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
      // 1. Trim Panel Active Mode
      if (trimOpenRef.current) {
        updatePointer(e);
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(trimInteractiveObjects, false);
        if (hits.length === 0) return;

        const hit = hits[0];
        const act = hit.object.userData.trimAction as string;

        if (act === "trim_in_knob") {
          trimDragMode = "in_knob";
          trimDragStartY = e.clientY;
          trimDragStartVal = trimStartRef.current;
        } else if (act === "trim_out_knob") {
          trimDragMode = "out_knob";
          trimDragStartY = e.clientY;
          trimDragStartVal = trimEndRef.current;
        } else if (act === "dial" && hit.uv) {
          const normX = uvToNormalizedPlotX(hit.uv.x);
          const distIn = Math.abs(normX - trimStartRef.current);
          const distOut = Math.abs(normX - trimEndRef.current);
          if (distIn <= distOut) {
            trimDragMode = "dial_in";
            callbacksRef.current.applyTrimChange(normX, trimEndRef.current);
          } else {
            trimDragMode = "dial_out";
            callbacksRef.current.applyTrimChange(trimStartRef.current, normX);
          }
        } else if (act === "trim_back") {
          pressedTrimKeyRef.current = act;
          window.setTimeout(() => {
            pressedTrimKeyRef.current = null;
            callbacksRef.current.onCloseTrim();
          }, 120);
        } else if (act === "trim_audition") {
          pressedTrimKeyRef.current = act;
          window.setTimeout(() => (pressedTrimKeyRef.current = null), 140);
          callbacksRef.current.onToggleAudition?.();
        } else if (act === "trim_reset") {
          pressedTrimKeyRef.current = act;
          window.setTimeout(() => (pressedTrimKeyRef.current = null), 140);
          callbacksRef.current.applyTrimChange(0, 1);
        } else if (act === "trim_export") {
          pressedTrimKeyRef.current = act;
          window.setTimeout(() => (pressedTrimKeyRef.current = null), 140);
          callbacksRef.current.onExportTrim?.();
        }
        return;
      }

      // 2. Front VFD Settings Mode
      if (settingsOpenRef.current) {
        updatePointer(e);
        raycaster.setFromCamera(pointer, camera);
        const vfdHits = raycaster.intersectObject(vfdScreenMesh, false);
        if (vfdHits.length > 0 && vfdHits[0].uv) {
          const row = Math.min(3, Math.max(0, Math.floor((1 - vfdHits[0].uv.y) * 4)));
          const item = vfdVisibleRowsRef.current[row];
          if (item) {
            vfdFlashRowRef.current = row;
            redrawVfdRef.current?.();
            window.setTimeout(() => {
              vfdFlashRowRef.current = -1;
              item.action();
              redrawVfdRef.current?.();
            }, 180);
          }
        }
        return;
      }

      // 3. Main Turntable View
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
      trimDragMode = null;
    };

    const handleWheel = (e: WheelEvent) => {
      if (trimOpenRef.current) {
        updatePointer(e as unknown as PointerEvent);
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(trimInteractiveObjects, false);
        if (hits.length > 0) {
          const act = hits[0].object.userData.trimAction;
          const step = e.deltaY < 0 ? 0.015 : -0.015;
          if (act === "trim_in_knob") {
            e.preventDefault();
            callbacksRef.current.applyTrimChange(
              trimStartRef.current + step,
              trimEndRef.current
            );
          } else if (act === "trim_out_knob") {
            e.preventDefault();
            callbacksRef.current.applyTrimChange(
              trimStartRef.current,
              trimEndRef.current + step
            );
          }
        }
        return;
      }

      if (settingsOpenRef.current) {
        updatePointer(e as unknown as PointerEvent);
        raycaster.setFromCamera(pointer, camera);
        const vfdHits = raycaster.intersectObject(vfdScreenMesh, false);
        if (vfdHits.length > 0) {
          e.preventDefault();
          vfdScrollRef.current += e.deltaY > 0 ? 1 : -1;
          redrawVfdRef.current?.();
        }
        return;
      }

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

    // ================= 60FPS PHYSICS & CAMERA FLIGHT LOOP =================
    let rafId = 0;
    let angularVel = 0;
    let currentArmYaw = 0.14;
    let currentArmPitch = 0.08;
    const trimActiveColor = new THREE.Color("#ffffff");
    const trimIdleColor = new THREE.Color("#6e6a63");
    let trimFlightT = 0;

    const animate = () => {
      const targetVel = isPlayingRef.current ? 0.048 : 0;
      angularVel += (targetVel - angularVel) * 0.06;
      vinylSpinGroup.rotation.y -= angularVel;
      strobeRing.rotation.y -= angularVel;

      const targetYaw = isPlayingRef.current ? -0.26 : 0.14;
      const targetPitch = isPlayingRef.current ? -0.025 : 0.08;
      currentArmYaw += (targetYaw - currentArmYaw) * 0.065;
      currentArmPitch += (targetPitch - currentArmPitch) * 0.08;
      armPivotGroup.rotation.y = currentArmYaw;
      armPivotGroup.rotation.x = currentArmPitch;

      if (centerPressBounceRef.current > 0.001) {
        centerPressBounceRef.current *= 0.84;
        vinylSpinGroup.position.y = 0.082 - centerPressBounceRef.current * 0.028;
      } else {
        vinylSpinGroup.position.y = 0.082;
      }

      modeMeshes.forEach(({ mode, mesh }) => {
        const targetY = activeModeRef.current === mode ? 0.052 : 0.092;
        mesh.position.y += (targetY - mesh.position.y) * 0.18;
      });

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

      const targetTrimY = hasSampleRef.current ? 0.095 : -0.008;
      trimKeyMesh.position.y += (targetTrimY - trimKeyMesh.position.y) * 0.14;

      const targetTrimEmissive = hasSampleRef.current ? 0.22 : 0;
      trimTopMat.emissiveIntensity +=
        (targetTrimEmissive - trimTopMat.emissiveIntensity) * 0.14;
      trimTopMat.color.lerp(
        hasSampleRef.current ? trimActiveColor : trimIdleColor,
        0.14
      );

      // USSR Trim Panel: Smoky acrylic cover hinge & ivory rotary knobs / piano keys
      const targetCoverRotX = trimOpenRef.current ? -1.36 : 0;
      trimCoverHingeGroup.rotation.x +=
        (targetCoverRotX - trimCoverHingeGroup.rotation.x) * 0.09;

      const targetInKnobRot = (0.5 - trimStartRef.current) * 4.8;
      const targetOutKnobRot = (0.5 - trimEndRef.current) * 4.8;
      inKnobGroup.rotation.y += (targetInKnobRot - inKnobGroup.rotation.y) * 0.22;
      outKnobGroup.rotation.y += (targetOutKnobRot - outKnobGroup.rotation.y) * 0.22;

      pianoKeyMeshes.forEach(({ id, mesh }) => {
        const isPressed = pressedTrimKeyRef.current === id;
        const targetKeyY = isPressed ? 0.064 : 0.082;
        mesh.position.y += (targetKeyY - mesh.position.y) * 0.24;
      });

      const clampedVu = Math.max(
        0,
        Math.min(1.15, isPlayingRef.current ? vuLevelRef.current : 0)
      );
      const targetNeedleRot = 0.72 - clampedVu * 1.38;
      needlePivot.rotation.y += (targetNeedleRot - needlePivot.rotation.y) * 0.25;

      const targetKnobRot = (0.5 - volumeRef.current) * 4.7;
      knobCapGroup.rotation.y += (targetKnobRot - knobCapGroup.rotation.y) * 0.22;

      const targetFrontWarm = settingsOpenRef.current ? 22 : 0;
      frontLeftWarmLight.intensity += (targetFrontWarm - frontLeftWarmLight.intensity) * 0.08;
      frontRightWarmLight.intensity += (targetFrontWarm - frontRightWarmLight.intensity) * 0.08;

      const targetPos = trimOpenRef.current
        ? trimCamPos
        : settingsOpenRef.current
        ? frontCamPos
        : topCamPos;
      const targetLook = trimOpenRef.current
        ? trimCamLook
        : settingsOpenRef.current
        ? frontCamLook
        : topCamLook;

      // Smooth cubic ease-in-out flight that lands at exact 0.000° parallel over the trim deck
      const targetTrimT = trimOpenRef.current ? 1 : 0;
      const flightStep = 0.036;
      if (trimFlightT < targetTrimT) {
        trimFlightT = Math.min(1, trimFlightT + flightStep);
      } else if (trimFlightT > targetTrimT) {
        trimFlightT = Math.max(0, trimFlightT - flightStep);
      }

      if (trimFlightT > 0) {
        const eased =
          trimFlightT < 0.5
            ? 4 * trimFlightT * trimFlightT * trimFlightT
            : 1 - Math.pow(-2 * trimFlightT + 2, 3) / 2;
        const basePos = settingsOpenRef.current ? frontCamPos : topCamPos;
        const baseLook = settingsOpenRef.current ? frontCamLook : topCamLook;
        camPosCurrent.lerpVectors(basePos, trimCamPos, eased);
        camLookCurrent.lerpVectors(baseLook, trimCamLook, eased);
      } else {
        const targetPos = settingsOpenRef.current ? frontCamPos : topCamPos;
        const targetLook = settingsOpenRef.current ? frontCamLook : topCamLook;
        camPosCurrent.lerp(targetPos, 0.085);
        camLookCurrent.lerp(targetLook, 0.085);
      }

      camera.position.copy(camPosCurrent);
      camera.lookAt(camLookCurrent);

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
      studioEnvRT.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  const handleSubmitVfdPhrase = async (e: React.FormEvent) => {
    e.preventDefault();
    const sec = vfdAddingSection;
    const trimmed = vfdNewPhrase.trim();
    if (!sec || !trimmed || !dictRef.current) {
      setVfdAddingSection(null);
      setVfdNewPhrase("");
      return;
    }
    if (!dictRef.current[sec].includes(trimmed)) {
      const updated: QueryDictionary = {
        ...dictRef.current,
        [sec]: [trimmed, ...dictRef.current[sec]],
      };
      dictRef.current = updated;
      await invoke("save_query_dictionary", { dict: updated }).catch(console.error);
    }
    setVfdNewPhrase("");
    setVfdAddingSection(null);
    redrawVfdRef.current?.();
  };

  return (
    <>
      <div ref={mountRef} className="fixed inset-0 w-screen h-screen z-0" />

      {/* Compact DAW Drag Handle when Trim Panel is active & slice is exported */}
      {/* Native OS Drag-to-DAW Grip Pad */}
      {trimOpen && exportedFilePath && (
        <div
          onMouseDown={() => onDragExportToDaw?.()}
          title="Drag directly into Ableton, FL Studio, Logic, or Reaper"
          className="fixed bottom-5 right-6 z-40 flex items-center gap-2.5 px-4 py-2 rounded-lg bg-gradient-to-b from-[#d8c39e] to-[#a88d63] border-2 border-[#3b2614] text-[#231407] shadow-[0_5px_0_#1a0e08,0_8px_16px_rgba(0,0,0,0.85)] cursor-grab active:cursor-grabbing hover:brightness-105 transition select-none"
        >
          <span className="font-chassis text-xs font-extrabold tracking-[0.16em]">
            ⋮⋮ DRAG TO DAW
          </span>
          <span className="font-mono-tech text-[10px] font-bold opacity-85 truncate max-w-[180px]">
            {exportedFilePath.split(/[/\\]/).pop()}
          </span>
        </div>
      )}

      {settingsOpen && vfdAddingSection && (
        <form
          onSubmit={handleSubmitVfdPhrase}
          className="fixed bottom-12 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-2 rounded-lg bg-[#04110f]/95 border border-[#6bfce4] shadow-[0_0_24px_rgba(62,252,224,0.35)] pointer-events-auto"
        >
          <span className="font-mono-tech text-xs text-[#6bfce4] tracking-widest">
            + NEW:
          </span>
          <input
            autoFocus
            value={vfdNewPhrase}
            onChange={(e) => setVfdNewPhrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setVfdAddingSection(null);
                setVfdNewPhrase("");
              }
            }}
            placeholder="Type search phrase & press Enter..."
            className="w-64 bg-transparent border-b border-[#6bfce4]/60 px-1.5 py-0.5 font-mono-tech text-xs text-[#a8fff0] placeholder-[#4fd1be]/40 outline-none"
          />
          <button
            type="submit"
            className="px-2.5 py-0.5 rounded bg-[#6bfce4] text-[#031412] font-mono-tech text-xs font-bold cursor-pointer"
          >
            ADD
          </button>
        </form>
      )}
    </>
  );
}