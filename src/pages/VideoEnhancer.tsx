import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import {
  Upload,
  Sun,
  Sparkles,
  Camera,
  Monitor,
  Undo2,
  Redo2,
  Download,
  RotateCcw,
  History,
  SlidersHorizontal,
  ChevronUp,
  ChevronDown,
  Sparkles as SparklesIcon,
  Undo,
  Redo,
  Scissors,
  X,
  Circle,
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { cn } from "../lib/utils";
import { exportVideo, processVideo, warmVideoProcessor } from "../lib/videoProcessor";
import { saveBlobToDevice } from "../lib/exportMedia";
import { UserTier } from "../types";
import { usePhotoStack } from "../lib/usePhotoStack";
import { HistoryDrawer } from "../components/HistoryDrawer";
import { PreviewRenderer } from "../components/PreviewRenderer";
import { getVideoThumbnail, registerVideoAsset, unregisterVideoAsset } from "../lib/videoThumbnails";
import { activateBeamScreen, releaseBeamScreen, updateBeamScreenBrightness } from "../lib/beamScreen";
import { getExportMode } from "../lib/exportRules";

interface VideoEnhancerProps {
  tier?: UserTier;
  onNavigate?: (tab: string) => void;
}

const VIDEO_TAB_TITLE = "Video Enhancer";
const VIDEO_TAB_DESCRIPTION = "Upgrade videos instantly";

type ManualFilterId =
  | "none"
  | "natural"
  | "milk"
  | "blackwhite"
  | "warm"
  | "cool"
  | "cinema"
  | "pop"
  | "faded"
  | "mono"
  | "softglow";

interface ManualEditState {
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  rotation: number;
  brightness: number;
  contrast: number;
  saturation: number;
  blur: number;
  filter: ManualFilterId;
}

const MANUAL_FILTERS = [
  { id: "none", label: "None" },
  { id: "natural", label: "Natural" },
  { id: "milk", label: "Milk" },
  { id: "blackwhite", label: "Black & White" },
  { id: "warm", label: "Warm" },
  { id: "cool", label: "Cool" },
  { id: "cinema", label: "Cinema" },
  { id: "pop", label: "Pop" },
  { id: "faded", label: "Faded" },
  { id: "mono", label: "Mono" },
  { id: "softglow", label: "Soft Glow" },
] as const;

function createDefaultManualEditState(): ManualEditState {
  return { cropX: 0, cropY: 0, cropWidth: 100, cropHeight: 100, rotation: 0, brightness: 100, contrast: 100, saturation: 100, blur: 0, filter: "none" };
}

function clampValue(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normaliseManualEditState(state: ManualEditState): ManualEditState {
  const cropX = clampValue(state.cropX, 0, 95);
  const cropY = clampValue(state.cropY, 0, 95);
  const cropWidth = clampValue(state.cropWidth, 5, 100 - cropX);
  const cropHeight = clampValue(state.cropHeight, 5, 100 - cropY);
  return { ...state, cropX, cropY, cropWidth, cropHeight, brightness: clampValue(state.brightness, 0, 200), contrast: clampValue(state.contrast, 0, 200), saturation: clampValue(state.saturation, 0, 200), blur: clampValue(state.blur, 0, 10) };
}

function hasPendingManualEdit(state: ManualEditState) {
  const safe = normaliseManualEditState(state);
  return safe.cropX !== 0
    || safe.cropY !== 0
    || safe.cropWidth !== 100
    || safe.cropHeight !== 100
    || safe.rotation !== 0
    || safe.brightness !== 100
    || safe.contrast !== 100
    || safe.saturation !== 100
    || safe.blur !== 0
    || safe.filter !== "none";
}

function getManualFilterCss(state: ManualEditState) {
  const preset = ({
    none: {},
    natural: { brightness: 102, contrast: 102, saturation: 104 },
    milk: { brightness: 126, contrast: 88, saturation: 80, blur: 0.45 },
    blackwhite: { grayscale: 100, contrast: 108 },
    warm: { brightness: 104, contrast: 102, saturation: 112, sepia: 10 },
    cool: { brightness: 101, contrast: 104, saturation: 105, hueRotate: 8 },
    cinema: { brightness: 98, contrast: 116, saturation: 110, sepia: 12 },
    pop: { brightness: 104, contrast: 120, saturation: 126 },
    faded: { brightness: 106, contrast: 82, saturation: 92 },
    mono: { grayscale: 55, contrast: 110, saturation: 80 },
    softglow: { brightness: 106, contrast: 95, saturation: 103, blur: 0.3 },
  } as any)[state.filter] || {};

  const brightness = ((state.brightness * (preset.brightness ?? 100)) / 100).toFixed(2);
  const contrast = ((state.contrast * (preset.contrast ?? 100)) / 100).toFixed(2);
  const saturation = ((state.saturation * (preset.saturation ?? 100)) / 100).toFixed(2);
  const blur = (state.blur + (preset.blur ?? 0)).toFixed(2);
  const grayscale = (preset.grayscale ?? 0).toFixed(2);
  const sepia = (preset.sepia ?? 0).toFixed(2);
  const hueRotate = (preset.hueRotate ?? 0).toFixed(2);
  return `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) blur(${blur}px) grayscale(${grayscale}%) sepia(${sepia}%) hue-rotate(${hueRotate}deg)`;
}



type FlashCamAspectRatio = "1:1" | "3:4" | "9:16";

type FlashCamColorOption = {
  id: string;
  label: string;
  hex: string;
};

const FLASHCAM_COLORS: FlashCamColorOption[] = [
  { id: "lavender", label: "Lavender", hex: "#E8DDF6" },
  { id: "blush", label: "Blush", hex: "#E9B3C0" },
  { id: "softpink", label: "Soft Pink", hex: "#F4C1D7" },
  { id: "palerose", label: "Pale Rose", hex: "#F3B7C8" },
  { id: "peach", label: "Warm Peach", hex: "#F7D3C2" },
  { id: "daylight", label: "Daylight", hex: "#FFF4DC" },
  { id: "white", label: "Warm White", hex: "#FFF8EF" },
];

const FLASHCAM_ASPECTS: FlashCamAspectRatio[] = ["1:1", "3:4", "9:16"];

function getFlashCamAspectNumeric(aspectRatio: FlashCamAspectRatio) {
  if (aspectRatio === "1:1") return 1;
  if (aspectRatio === "3:4") return 3 / 4;
  return 9 / 16;
}

function getFlashCamAspectValue(aspectRatio: FlashCamAspectRatio) {
  if (aspectRatio === "1:1") return "1 / 1";
  if (aspectRatio === "3:4") return "3 / 4";
  return "9 / 16";
}


function getBeamCameraBaseConstraints(): MediaTrackConstraints {
  return {
    facingMode: { ideal: "user" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 24, max: 30 },
  };
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized;
  const intValue = Number.parseInt(value, 16);
  return {
    r: (intValue >> 16) & 255,
    g: (intValue >> 8) & 255,
    b: intValue & 255,
  };
}

function rgba(hex: string, alpha: number) {
  const { r, g, b } = hexToRgb(hex);
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

function getBeamColorLuminance(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const toLinear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function getBeamLightWeight(hex: string) {
  return clampValue(0.72 + getBeamColorLuminance(hex) * 1.9, 0.72, 1.75);
}

function getBeamPreviewFilterCss(hex: string, previewLightStrength: number) {
  const lightWeight = getBeamLightWeight(hex);
  const brightness = 118 + previewLightStrength * 34 + (lightWeight - 1) * 26;
  const contrast = 106 + previewLightStrength * 9 + (lightWeight - 1) * 6;
  const saturation = 104 + previewLightStrength * 12 + (lightWeight - 1) * 8;
  const sepia = clampValue((lightWeight - 1) * 12, 0, 10);
  return `brightness(${brightness.toFixed(2)}%) contrast(${contrast.toFixed(2)}%) saturate(${saturation.toFixed(2)}%) sepia(${sepia.toFixed(2)}%)`;
}

function getCoverCropRect(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) {
  const safeSourceWidth = Math.max(sourceWidth, 1);
  const safeSourceHeight = Math.max(sourceHeight, 1);
  const safeTargetWidth = Math.max(targetWidth, 1);
  const safeTargetHeight = Math.max(targetHeight, 1);

  const sourceAspect = safeSourceWidth / safeSourceHeight;
  const targetAspect = safeTargetWidth / safeTargetHeight;

  if (sourceAspect > targetAspect) {
    const cropWidth = safeSourceHeight * targetAspect;
    const offsetX = (safeSourceWidth - cropWidth) * 0.5;
    return { sx: offsetX, sy: 0, sw: cropWidth, sh: safeSourceHeight };
  }

  const cropHeight = safeSourceWidth / targetAspect;
  const offsetY = (safeSourceHeight - cropHeight) * 0.5;
  return { sx: 0, sy: offsetY, sw: safeSourceWidth, sh: cropHeight };
}

function getContainDrawRect(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) {
  const safeSourceWidth = Math.max(sourceWidth, 1);
  const safeSourceHeight = Math.max(sourceHeight, 1);
  const safeTargetWidth = Math.max(targetWidth, 1);
  const safeTargetHeight = Math.max(targetHeight, 1);

  const scale = Math.min(safeTargetWidth / safeSourceWidth, safeTargetHeight / safeSourceHeight);
  const drawWidth = safeSourceWidth * scale;
  const drawHeight = safeSourceHeight * scale;
  const dx = (safeTargetWidth - drawWidth) * 0.5;
  const dy = (safeTargetHeight - drawHeight) * 0.5;

  return { dx, dy, dw: drawWidth, dh: drawHeight };
}

function getBeamPreviewBoxClassName(aspectRatio: FlashCamAspectRatio) {
  if (aspectRatio === "9:16") return "w-full max-w-[190px] sm:max-w-[210px] md:max-w-[230px]";
  if (aspectRatio === "3:4") return "w-full max-w-[220px] md:max-w-[250px]";
  return "w-full max-w-[240px] md:max-w-[270px]";
}

function shouldBeamUseCover(aspectRatio: FlashCamAspectRatio) {
  return aspectRatio === "1:1" || aspectRatio === "3:4";
}

function getFlashCamSupportedMimeType() {
  const candidates = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  for (const candidate of candidates) {
    if ((window as any).MediaRecorder?.isTypeSupported?.(candidate)) return candidate;
  }
  return "video/webm";
}

function compileFlashCamShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Beam Mode shader could not be created.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader) || "Unknown shader compile error.";
    gl.deleteShader(shader);
    throw new Error(error);
  }
  return shader;
}

function createFlashCamProgram(gl: WebGLRenderingContext) {
  const vertexSource = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = (a_position + 1.0) * 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fragmentSource = `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform vec2 u_scale;
    uniform vec2 u_offset;
    uniform vec3 u_light_color;
    uniform float u_intensity;
    uniform vec2 u_light_center;
    uniform float u_aspect;

    void main() {
      vec2 source_uv = u_offset + (v_uv * u_scale);
      vec4 texel = texture2D(u_texture, source_uv);
      vec3 base = texel.rgb;
      float luma = dot(base, vec3(0.2126, 0.7152, 0.0722));

      vec2 delta = v_uv - u_light_center;
      delta.x *= u_aspect;
      float dist = length(delta);
      float glow = smoothstep(1.08, 0.0, dist);
      float hotspot = smoothstep(0.62, 0.0, dist);
      float halo = smoothstep(1.28, 0.18, dist);
      float highlight_weight = mix(0.74, 1.24, sqrt(max(luma, 0.0)));
      float sculpt = mix(0.78, 1.0, hotspot);
      vec3 light = u_light_color * u_intensity * glow * sculpt * (0.42 + 0.58 * highlight_weight);
      vec3 lit = base + light * (1.0 - base);
      lit += vec3(u_intensity * 0.05 * halo * (0.5 + 0.5 * luma));
      lit = mix(lit, min(lit * 1.025 + 0.006, 1.0), min(0.42, u_intensity * 0.16));

      gl_FragColor = vec4(clamp(lit, 0.0, 1.0), texel.a);
    }
  `;

  const program = gl.createProgram();
  if (!program) throw new Error("Beam Mode program could not be created.");

  const vertexShader = compileFlashCamShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileFlashCamShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const error = gl.getProgramInfoLog(program) || "Unknown shader link error.";
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error(error);
  }

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  return program;
}

interface FlashCamStudioProps {
  open: boolean;
  onClose: () => void;
  onSave: (videoUrl: string, fileName: string) => Promise<void> | void;
}

function FlashCamStudio({ open, onClose, onSave }: FlashCamStudioProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const beamMasterStreamRef = useRef<MediaStream | null>(null);
  const beamPreviewStreamRef = useRef<MediaStream | null>(null);
  const beamRecorderRef = useRef<MediaRecorder | null>(null);
  const beamChunksRef = useRef<Blob[]>([]);
  const beamInitTokenRef = useRef(0);
  const beamReadyTimeoutRef = useRef<number | null>(null);
  const beamRecordingTimeoutRef = useRef<number | null>(null);
  const selectedColorRef = useRef<FlashCamColorOption>(FLASHCAM_COLORS[1]);
  const beamScreenActiveRef = useRef(false);
  const brightnessRef = useRef(62);
  const aspectRatioRef = useRef<FlashCamAspectRatio>("9:16");
  const recordingStateRef = useRef(false);
  const discardRecordingRef = useRef(false);
  const previewStartedRef = useRef(false);
  const isScreenActiveRef = useRef(false);
  const isStartingCameraRef = useRef(false);
  const previewFrameLogRef = useRef(false);
  const [selectedColorId, setSelectedColorId] = useState(FLASHCAM_COLORS[1].id);
  const [brightness, setBrightness] = useState(62);
  const [aspectRatio, setAspectRatio] = useState<FlashCamAspectRatio>("9:16");
  const [isRecording, setIsRecording] = useState(false);
  const [isBooting, setIsBooting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cameraPermissionState, setCameraPermissionState] = useState<"checking" | "prompt" | "granted" | "denied">("checking");

  const logBeam = useCallback((step: string, details?: unknown) => {
    if (details === undefined) {
      console.info(`[Beam Mode] ${step}`);
    } else {
      console.info(`[Beam Mode] ${step}`, details);
    }
  }, []);

  const clearBeamReadyTimeout = useCallback(() => {
    if (beamReadyTimeoutRef.current !== null) {
      window.clearTimeout(beamReadyTimeoutRef.current);
      beamReadyTimeoutRef.current = null;
    }
  }, []);

  const resetBeamRecorder = useCallback((stopActiveRecorder = false) => {
    if (beamRecordingTimeoutRef.current !== null) {
      window.clearTimeout(beamRecordingTimeoutRef.current);
      beamRecordingTimeoutRef.current = null;
    }

    const recorder = beamRecorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (stopActiveRecorder && recorder.state !== "inactive") {
        try { recorder.stop(); } catch {}
      }
    }

    beamRecorderRef.current = null;
    beamChunksRef.current = [];
  }, []);

  const cleanupRenderer = useCallback((options?: { invalidateSession?: boolean; preserveStartingFlag?: boolean }) => {
    const invalidateSession = options?.invalidateSession ?? true;
    const preserveStartingFlag = options?.preserveStartingFlag ?? false;

    if (invalidateSession) {
      beamInitTokenRef.current += 1;
    }

    clearBeamReadyTimeout();
    previewStartedRef.current = false;
    previewFrameLogRef.current = false;
    if (!preserveStartingFlag) {
      isStartingCameraRef.current = false;
    }
    recordingStateRef.current = false;

    resetBeamRecorder(true);

    const masterTrackIds = new Set(beamMasterStreamRef.current?.getTracks().map((track) => track.id) || []);
    if (beamPreviewStreamRef.current) {
      beamPreviewStreamRef.current.getTracks().forEach((track) => {
        if (!masterTrackIds.has(track.id)) {
          track.stop();
        }
      });
    }
    beamPreviewStreamRef.current = null;

    beamMasterStreamRef.current?.getTracks().forEach((track) => track.stop());
    beamMasterStreamRef.current = null;

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }

    const video = videoRef.current;
    if (video) {
      try { video.pause(); } catch {}
      video.srcObject = null;
      video.removeAttribute("src");
      video.load?.();
    }
  }, [clearBeamReadyTimeout, resetBeamRecorder]);

  useEffect(() => {
    selectedColorRef.current = FLASHCAM_COLORS.find((color) => color.id === selectedColorId) || FLASHCAM_COLORS[1];
  }, [selectedColorId]);

  useEffect(() => {
    brightnessRef.current = brightness;
  }, [brightness]);

  useEffect(() => {
    if (!open) return;

    const normalizedBrightness = Math.max(0.08, Math.min(1, brightness / 100));

    if (!beamScreenActiveRef.current) {
      beamScreenActiveRef.current = true;
      void activateBeamScreen(normalizedBrightness);
      return;
    }

    void updateBeamScreenBrightness(normalizedBrightness);
  }, [brightness, open]);

  useEffect(() => {
    aspectRatioRef.current = aspectRatio;
  }, [aspectRatio]);

  useEffect(() => {
    recordingStateRef.current = isRecording;
  }, [isRecording]);

  const getBeamOverlayStrength = useCallback(() => {
    const normalized = Math.min(1, Math.max(0, brightnessRef.current / 100));
    return 0.24 + normalized * 0.76;
  }, []);

  const getPreviewLightStrength = useCallback(() => {
    const normalized = Math.min(1, Math.max(0, brightnessRef.current / 100));
    return 0.18 + normalized * 0.82;
  }, []);

  const waitForPreviewFrame = useCallback((video: HTMLVideoElement) => new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      settled = true;
      video.removeEventListener("loadeddata", handleReady);
      video.removeEventListener("canplay", handleReady);
      video.removeEventListener("playing", handleReady);
      video.removeEventListener("error", handleError);
    };
    const finish = () => {
      if (settled) return;
      cleanup();
      resolve();
    };
    const fail = (message: string) => {
      if (settled) return;
      cleanup();
      reject(new Error(message));
    };
    const handleReady = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) finish();
    };
    const handleError = () => fail("Beam Mode preview surface failed to load.");

    if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      finish();
      return;
    }

    if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
      const callback = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          finish();
        }
      };
      (video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback?.(callback);
    }

    video.addEventListener("loadeddata", handleReady, { once: true });
    video.addEventListener("canplay", handleReady, { once: true });
    video.addEventListener("playing", handleReady, { once: true });
    video.addEventListener("error", handleError, { once: true });
  }), []);

  const logBeamCameraState = useCallback((track: MediaStreamTrack | null, reason: string) => {
    const video = videoRef.current;
    const container = video?.parentElement;
    const settings = (track?.getSettings?.() || {}) as MediaTrackSettings & { zoom?: number };
    const capabilities = ((track as MediaStreamTrack & { getCapabilities?: () => Record<string, unknown> })?.getCapabilities?.() || {}) as MediaTrackCapabilities & { zoom?: { min?: number; max?: number }, resizeMode?: string[] };
    const viewport = container?.getBoundingClientRect();

    logBeam(reason, {
      lensFacing: settings.facingMode || "unknown",
      zoomRatio: typeof settings.zoom === "number" ? settings.zoom : 1,
      cropRegion: null,
      sensorSize: capabilities.width && capabilities.height
        ? { width: (capabilities as any).width?.max ?? null, height: (capabilities as any).height?.max ?? null }
        : null,
      previewOutputResolution: settings.width && settings.height
        ? { width: settings.width, height: settings.height }
        : video?.videoWidth && video?.videoHeight
          ? { width: video.videoWidth, height: video.videoHeight }
          : null,
      displayViewportResolution: viewport
        ? { width: Math.round(viewport.width), height: Math.round(viewport.height) }
        : null,
      capabilities,
      settings,
    });
  }, [logBeam]);

  const applyBeamTrackTuning = useCallback(async (track: MediaStreamTrack, nextAspect: FlashCamAspectRatio) => {
    const videoTrack = track as MediaStreamTrack & {
      getCapabilities?: () => Record<string, any>;
      applyConstraints?: (constraints: MediaTrackConstraints) => Promise<void>;
    };
    const capabilities = (videoTrack.getCapabilities?.() || {}) as MediaTrackCapabilities & { zoom?: { min?: number; max?: number }, resizeMode?: string[] };
    const advanced: MediaTrackConstraints[] = [];

    if (capabilities.zoom && typeof capabilities.zoom.min === "number") {
      advanced.push(({ zoom: Math.max(1, capabilities.zoom.min) } as unknown) as MediaTrackConstraints);
    } else {
      advanced.push(({ zoom: 1 } as unknown) as MediaTrackConstraints);
    }

    if (capabilities.resizeMode && Array.isArray(capabilities.resizeMode) && capabilities.resizeMode.includes("none")) {
      advanced.push(({ resizeMode: "none" } as unknown) as MediaTrackConstraints);
    }

    if (!videoTrack.applyConstraints) {
      logBeamCameraState(track, `beam camera state (${nextAspect})`);
      return;
    }

    try {
      await videoTrack.applyConstraints({ advanced });
      logBeam("front camera tuned", { nextAspect, advanced });
    } catch (error) {
      logBeam("front camera tuning fallback", error);
    }

    logBeamCameraState(track, `beam camera state (${nextAspect})`);
  }, [logBeam, logBeamCameraState]);


  useEffect(() => {
    if (!open || !beamMasterStreamRef.current || isRecording) return;

    const track = beamMasterStreamRef.current.getVideoTracks()[0];
    if (!track) return;

    const nextAspect = getFlashCamAspectNumeric(aspectRatio);
    logBeam("aspect ratio update requested", {
      aspectRatio,
      nextAspect,
      behavior: "ui-frame-only; camera stream remains unzoomed",
    });
    void applyBeamTrackTuning(track, aspectRatio);
  }, [applyBeamTrackTuning, aspectRatio, isRecording, logBeam, open]);

  const getBeamRecorderOptions = useCallback(() => {
    const candidates = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp8,opus", "video/webm"];
    for (const candidate of candidates) {
      if (window.MediaRecorder?.isTypeSupported?.(candidate)) {
        return { mimeType: candidate } satisfies MediaRecorderOptions;
      }
    }
    return {} satisfies MediaRecorderOptions;
  }, []);

  const initialiseBeamModeCamera = useCallback(async () => {
    if (!open || !isScreenActiveRef.current || isStartingCameraRef.current) {
      return;
    }

    const initToken = beamInitTokenRef.current + 1;
    beamInitTokenRef.current = initToken;
    isStartingCameraRef.current = true;
    cleanupRenderer({ invalidateSession: false, preserveStartingFlag: true });
    logBeam("Beam screen mounted");

    if (isScreenActiveRef.current) {
      setIsBooting(true);
      setErrorMessage(null);
      setCameraPermissionState("checking");
    }

    const ensureActiveInit = (streamToStop?: MediaStream | null) => {
      if (!isScreenActiveRef.current || beamInitTokenRef.current !== initToken) {
        streamToStop?.getTracks().forEach((track) => track.stop());
        throw new Error("Beam Mode startup was cancelled.");
      }
    };

    const waitForVideoElement = async () => {
      for (let i = 0; i < 24; i += 1) {
        ensureActiveInit();
        const video = videoRef.current;
        if (video) return video;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      throw new Error("Beam Mode preview surface is unavailable.");
    };

    const openUnifiedStream = async () => {
      const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      } satisfies MediaTrackConstraints;

      const primaryConstraints = {
        video: getBeamCameraBaseConstraints(),
        audio: audioConstraints,
      } satisfies MediaStreamConstraints;

      const fallbackConstraints = {
        video: { facingMode: "user" },
        audio: true,
      } satisfies MediaStreamConstraints;

      logBeam("front camera requested", primaryConstraints);

      try {
        return await navigator.mediaDevices.getUserMedia(primaryConstraints);
      } catch (primaryError: any) {
        logBeam("front camera request failed; retrying fallback constraints", primaryError);
        return navigator.mediaDevices.getUserMedia(fallbackConstraints);
      }
    };

    const bindPreview = async (video: HTMLVideoElement, previewStream: MediaStream) => {
      ensureActiveInit(previewStream);

      video.muted = true;
      video.defaultMuted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "true");
      video.setAttribute("autoplay", "true");
      video.setAttribute("muted", "true");
      video.srcObject = previewStream;

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          video.removeEventListener("loadedmetadata", onLoadedMetadata);
          video.removeEventListener("error", onError);
          resolve();
        };
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          video.removeEventListener("loadedmetadata", onLoadedMetadata);
          video.removeEventListener("error", onError);
          reject(error);
        };
        const onLoadedMetadata = () => finish();
        const onError = () => fail(new Error("Beam Mode preview surface failed to load."));

        if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth > 0 && video.videoHeight > 0) {
          finish();
          return;
        }

        video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
        video.addEventListener("error", onError, { once: true });
      });

      ensureActiveInit(previewStream);
      const playResult = video.play();
      if (playResult && typeof playResult.then === "function") {
        await playResult;
      }
      ensureActiveInit(previewStream);
    };

    let masterStream: MediaStream | null = null;
    let previewStream: MediaStream | null = null;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This device does not support camera access for Beam Mode.");
      }

      const video = await waitForVideoElement();
      ensureActiveInit();

      masterStream = await openUnifiedStream();
      ensureActiveInit(masterStream);
      logBeam("camera provider acquired");

      const activeVideoTrack = masterStream.getVideoTracks()[0];
      const activeAudioTrack = masterStream.getAudioTracks()[0];

      if (!activeVideoTrack) {
        throw new Error("Beam Mode could not access the front camera on this device.");
      }

      if (!activeAudioTrack) {
        throw new Error("Beam Mode could not attach the microphone.");
      }

      activeAudioTrack.enabled = true;
      await applyBeamTrackTuning(activeVideoTrack, aspectRatioRef.current);
      ensureActiveInit(masterStream);
      logBeamCameraState(activeVideoTrack, "beam camera state after acquisition");

      previewStream = new MediaStream([activeVideoTrack]);
      ensureActiveInit(previewStream);

      beamMasterStreamRef.current = masterStream;
      beamPreviewStreamRef.current = previewStream;
      await Promise.race([
        (async () => {
          await bindPreview(video, previewStream as MediaStream);
          ensureActiveInit(previewStream);
          await waitForPreviewFrame(video);
        })(),
        new Promise<never>((_, reject) => {
          clearBeamReadyTimeout();
          beamReadyTimeoutRef.current = window.setTimeout(() => {
            reject(new Error("Beam Mode could not start the front camera preview."));
          }, 10000);
        }),
      ]);
      ensureActiveInit(previewStream);

      const liveVideoTrack = beamMasterStreamRef.current?.getVideoTracks()?.[0] ?? null;
      const liveAudioTrack = beamMasterStreamRef.current?.getAudioTracks()?.[0] ?? null;
      if (!liveVideoTrack || liveVideoTrack.readyState !== "live" || !liveAudioTrack || liveAudioTrack.readyState !== "live" || !video.srcObject || video.srcObject !== previewStream || video.videoWidth < 1 || video.videoHeight < 1) {
        throw new Error("Beam Mode could not start the front camera preview.");
      }

      previewStartedRef.current = true;
      previewFrameLogRef.current = true;
      setCameraPermissionState("granted");
      setIsBooting(false);
      setErrorMessage(null);
      logBeam("preview bound");
      logBeam("preview frame received");
    } catch (error: any) {
      previewStream?.getTracks().forEach((track) => track.stop());
      masterStream?.getTracks().forEach((track) => track.stop());
      if (!isScreenActiveRef.current || beamInitTokenRef.current !== initToken) {
        return;
      }
      cleanupRenderer({ invalidateSession: false });
      console.error(error);
      const permissionDenied = error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError" || error?.name === "SecurityError";
      if (permissionDenied) {
        setCameraPermissionState("denied");
        setErrorMessage("Camera and microphone permission is required. Allow access to open Beam Mode.");
      } else if (error?.name === "NotFoundError") {
        setCameraPermissionState("granted");
        setErrorMessage("Beam Mode could not find a front camera on this device.");
      } else if (error?.name === "NotReadableError") {
        setCameraPermissionState("granted");
        setErrorMessage("Beam Mode could not start the camera or microphone because the device is busy. Close other camera apps and try again.");
      } else if (error?.name === "OverconstrainedError") {
        setCameraPermissionState("granted");
        setErrorMessage("Beam Mode could not start with the current camera settings on this device. Please retry.");
      } else if (error?.name === "AbortError") {
        setCameraPermissionState("granted");
        setErrorMessage("Beam Mode startup was interrupted. Please retry.");
      } else if (error?.message !== "Beam Mode startup was cancelled.") {
        setCameraPermissionState("granted");
        setErrorMessage(error?.message || "Beam Mode could not open the front camera.");
      }
      setIsBooting(false);
    } finally {
      if (beamInitTokenRef.current === initToken) {
        clearBeamReadyTimeout();
        isStartingCameraRef.current = false;
      }
    }
  }, [applyBeamTrackTuning, cleanupRenderer, clearBeamReadyTimeout, logBeam, logBeamCameraState, open, waitForPreviewFrame]);

  useEffect(() => {
    isScreenActiveRef.current = open;

    if (!open) {
      cleanupRenderer();
      beamScreenActiveRef.current = false;
      void releaseBeamScreen();
      setIsRecording(false);
      setIsBooting(false);
      setErrorMessage(null);
      setCameraPermissionState("checking");
      return;
    }

    logBeam("Beam Mode clicked");
    void initialiseBeamModeCamera();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && !beamMasterStreamRef.current && !isStartingCameraRef.current) {
        void initialiseBeamModeCamera();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    const appStateListenerPromise = CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive && !beamMasterStreamRef.current && !isStartingCameraRef.current) {
        void initialiseBeamModeCamera();
      }
    });

    return () => {
      isScreenActiveRef.current = false;
      beamScreenActiveRef.current = false;
      void releaseBeamScreen();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      appStateListenerPromise.then((listener) => listener.remove()).catch(() => undefined);
      cleanupRenderer();
    };
  }, [open, cleanupRenderer, initialiseBeamModeCamera, logBeam]);

  const handleRecordToggle = useCallback(async () => {
    const masterStream = beamMasterStreamRef.current;
    const video = videoRef.current;

    if (!masterStream || !video || !previewStartedRef.current) {
      toast.error("Front camera is not ready yet.");
      return;
    }

    if (isRecording) {
      const recorder = beamRecorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      return;
    }

    try {
      const liveVideoTrack = masterStream.getVideoTracks()[0];
      const liveAudioTrack = masterStream.getAudioTracks()[0];

      if (!liveVideoTrack || liveVideoTrack.readyState !== "live") {
        throw new Error("Beam Mode camera is not ready.");
      }

      if (!liveAudioTrack || liveAudioTrack.readyState !== "live") {
        throw new Error("Microphone is not available.");
      }

      discardRecordingRef.current = false;
      beamChunksRef.current = [];
      resetBeamRecorder(true);

      recordingStateRef.current = true;

      const recorderOptions = getBeamRecorderOptions();
      let recorder: MediaRecorder;
      try {
        recorder = recorderOptions.mimeType
          ? new MediaRecorder(masterStream, recorderOptions)
          : new MediaRecorder(masterStream);
      } catch (recorderError) {
        if (!recorderOptions.mimeType) {
          throw recorderError;
        }

        logBeam("recorder mimeType fallback", recorderError);
        recorder = new MediaRecorder(masterStream);
      }

      beamRecorderRef.current = recorder;
      logBeam("recorder bound", { mimeType: recorder.mimeType || recorderOptions.mimeType || "default" });
      logBeam("microphone attached", { audioTracks: masterStream.getAudioTracks().length });

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          beamChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        if (beamRecordingTimeoutRef.current !== null) {
          window.clearTimeout(beamRecordingTimeoutRef.current);
          beamRecordingTimeoutRef.current = null;
        }
        const mimeType = recorder.mimeType || recorderOptions.mimeType || "video/webm";
        const chunks = [...beamChunksRef.current];
        beamChunksRef.current = [];
        recordingStateRef.current = false;
        setIsRecording(false);

        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
        if (beamRecorderRef.current === recorder) {
          beamRecorderRef.current = null;
        }

        if (discardRecordingRef.current) {
          discardRecordingRef.current = false;
          return;
        }

        if (!chunks.length) {
          toast.error("Beam Mode recording was empty. Please try again.");
          return;
        }

        const blob = new Blob(chunks, { type: mimeType });
        if (!blob.size) {
          toast.error("Beam Mode recording was empty. Please try again.");
          return;
        }

        const extension = mimeType.includes("mp4") ? "mp4" : "webm";
        const videoUrl = URL.createObjectURL(blob);

        void Promise.resolve(onSave(videoUrl, `beam-mode-${Date.now()}.${extension}`))
          .then(() => {
            toast.success("Beam Mode recording saved.");
            onClose();
          })
          .catch((error: any) => {
            try { URL.revokeObjectURL(videoUrl); } catch {}
            console.error("Beam Mode recording handoff failed", error);
            toast.error(error?.message || "Beam Mode recording could not be prepared.");
          });
      };

      recorder.onerror = () => {
        if (beamRecordingTimeoutRef.current !== null) {
          window.clearTimeout(beamRecordingTimeoutRef.current);
          beamRecordingTimeoutRef.current = null;
        }
        recordingStateRef.current = false;
        setIsRecording(false);
        beamChunksRef.current = [];
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
        if (beamRecorderRef.current === recorder) {
          beamRecorderRef.current = null;
        }
        toast.error("Beam Mode recording failed.");
      };

      recorder.start(250);
      beamRecordingTimeoutRef.current = window.setTimeout(() => {
        if (beamRecorderRef.current === recorder && recorder.state !== "inactive") {
          toast.message("Beam Mode auto-stopped to keep the HD clip fast to edit.");
          recorder.stop();
        }
      }, 45_000);
      setIsRecording(true);
    } catch (error: any) {
      recordingStateRef.current = false;
      beamChunksRef.current = [];
      beamRecorderRef.current = null;
      console.error(error);
      const permissionDenied = error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError" || error?.name === "SecurityError";
      toast.error(permissionDenied ? "Microphone permission is required to record Beam Mode audio." : (error?.message || "Beam Mode recording failed to start."));
    }
  }, [getBeamRecorderOptions, isRecording, logBeam, onClose, onSave, resetBeamRecorder]);

  const handleAspectToggle = useCallback(() => {
    setAspectRatio((current) => {
      const currentIndex = FLASHCAM_ASPECTS.indexOf(current);
      return FLASHCAM_ASPECTS[(currentIndex + 1) % FLASHCAM_ASPECTS.length];
    });
  }, []);

  const handleClose = useCallback(() => {
    if (isRecording) {
      discardRecordingRef.current = true;
      const recorder = beamRecorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
    }
    cleanupRenderer();
    beamScreenActiveRef.current = false;
    void releaseBeamScreen();
    setIsRecording(false);
    onClose();
  }, [cleanupRenderer, isRecording, onClose]);

  if (!open) return null;

  const selectedColor = FLASHCAM_COLORS.find((color) => color.id === selectedColorId) || FLASHCAM_COLORS[1];
  const previewGlowStrength = getBeamOverlayStrength();

  return (
    <div
      className="fixed inset-0 z-[70]"
      style={{ backgroundColor: selectedColor.hex, color: "#161214" }}
    >
      <div className="flex h-full flex-col relative">
        <div className="flex items-center justify-between px-4 py-4 border-b border-black/10 bg-black/12 backdrop-blur-xl">
          <button onClick={handleClose} className="h-10 w-10 rounded-full border border-black/10 bg-black/10 flex items-center justify-center hover:bg-black/15 transition-colors">
            <X className="w-5 h-5" />
          </button>
          <div className="text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-black/45">Video Tool</p>
            <h2 className="text-sm font-semibold">Beam Mode</h2>
          </div>
          <div className="w-10" />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
          <div className="relative rounded-[2rem] border border-black/10 bg-white/14 p-4 shadow-2xl overflow-hidden min-h-[420px] flex items-center justify-center">
            <div
              className="pointer-events-none absolute inset-0 rounded-[2rem]"
              style={{
                backgroundColor: selectedColor.hex,
                opacity: Math.max(0.72, previewGlowStrength),
                boxShadow: `0 0 120px ${rgba(selectedColor.hex, 0.38)}`,
              }}
            />
            <div
              className={cn(
                "mx-auto relative overflow-hidden rounded-[1.75rem] bg-black border border-white/10 shadow-[0_16px_60px_rgba(0,0,0,0.45)]",
                getBeamPreviewBoxClassName(aspectRatio),
              )}
              style={{ aspectRatio: getFlashCamAspectValue(aspectRatio) }}
            >
              <video
                ref={videoRef}
                className={cn(
                  "absolute inset-0 h-full w-full scale-x-[-1] bg-black",
                  shouldBeamUseCover(aspectRatio) ? "object-cover" : "object-contain",
                )}
                style={{ background: "#000000", objectPosition: "center center" }}
                playsInline
                muted
                autoPlay
              />
              <canvas ref={canvasRef} className="hidden" />
              <div className="absolute left-4 top-4 rounded-full border border-white/20 bg-black/30 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white backdrop-blur-md">
                {aspectRatio}
              </div>
              {isBooting && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/72 backdrop-blur-sm">
                  <div className="text-center space-y-2">
                    <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/50">Opening front camera</p>
                    <p className="text-sm text-white/80">Preparing your lighting studio...</p>
                  </div>
                </div>
              )}
              {errorMessage && !isBooting && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/82 p-6 text-center">
                  <div className="space-y-3">
                    <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/50">Beam Mode unavailable</p>
                    <p className="text-sm text-white/85">{errorMessage}</p>
                    {cameraPermissionState === "denied" && (
                      <p className="text-xs text-white/55">Camera access is enforced for Beam Mode. Enable the front camera permission in your device settings, then reopen this tool.</p>
                    )}
                    <button
                      onClick={() => void initialiseBeamModeCamera()}
                      className="mx-auto inline-flex h-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 text-[11px] font-bold uppercase tracking-[0.18em] text-white hover:bg-white/10 transition-colors"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-black/50">Light colour</p>
              <p className="text-[11px] text-black/55">Tap to switch instantly</p>
            </div>
            <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
              {FLASHCAM_COLORS.map((color) => {
                const selected = color.id === selectedColorId;
                return (
                  <button
                    key={color.id}
                    onClick={() => setSelectedColorId(color.id)}
                    className="flex flex-col items-center gap-2 min-w-[58px]"
                  >
                    <span
                      className={cn(
                        "h-12 w-12 rounded-full border-2 transition-all shadow-[0_0_24px_rgba(255,255,255,0.08)]",
                        selected ? "border-white scale-105" : "border-white/15",
                      )}
                      style={{ backgroundColor: color.hex }}
                    />
                    <span className={cn("text-[10px] font-bold uppercase tracking-[0.16em]", selected ? "text-black" : "text-black/45")}>{color.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-black/10 bg-black/[0.10] p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-black/50">Brightness</p>
                <h3 className="text-base font-semibold">Powerful front light</h3>
              </div>
              <span className="rounded-full border border-black/10 bg-white/55 px-3 py-1 text-xs font-semibold text-black">{brightness}%</span>
            </div>
            <input
              type="range"
              min={8}
              max={100}
              value={brightness}
              onChange={(event) => setBrightness(Number(event.target.value))}
              className="w-full accent-black"
            />
            <div className="flex items-center justify-between text-[11px] text-black/50">
              <span>Soft glow</span>
              <span>Flash-level lift</span>
            </div>
          </div>
        </div>

        <div className="border-t border-black/10 bg-black/12 px-4 py-4 backdrop-blur-xl">
          <div className="mx-auto flex max-w-sm items-center justify-between gap-3">
            <button
              onClick={handleAspectToggle}
              className="h-12 rounded-2xl border border-black/10 bg-black/10 px-4 text-xs font-bold uppercase tracking-[0.18em] hover:bg-black/15 transition-colors"
            >
              {aspectRatio}
            </button>

            <button
              onClick={handleRecordToggle}
              disabled={!!errorMessage || isBooting}
              className={cn(
                "h-20 w-20 rounded-full border-4 flex items-center justify-center transition-all shadow-2xl disabled:opacity-40 disabled:cursor-not-allowed",
                isRecording ? "border-red-500 bg-red-500/20" : "border-black bg-white/75 hover:bg-white/90",
              )}
            >
              {isRecording ? <div className="h-7 w-7 rounded-md bg-red-400" /> : <Circle className="h-9 w-9 fill-black text-black" strokeWidth={1.6} />}
            </button>

            <button
              onClick={() => setBrightness((current) => (current >= 96 ? 62 : Math.min(100, current + 12)))}
              className="h-12 rounded-2xl border border-black/10 bg-black/10 px-4 text-xs font-bold uppercase tracking-[0.18em] hover:bg-black/15 transition-colors"
            >
              Boost
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function VideoEnhancer({ tier = "free", onNavigate }: VideoEnhancerProps) {
  const [originalFile, setOriginalFile] = useState<string | null>(null);
  const [originalFileName, setOriginalFileName] = useState<string | null>(null);
  const {
    currentImage: file,
    currentEntry,
    pushImage: setFile,
    undo,
    redo,
    reset,
    selectHistory,
    canUndo,
    canRedo,
    historyEntries,
  } = usePhotoStack(null);

  const [isEnhancing, setIsEnhancing] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [previewThumbnail, setPreviewThumbnail] = useState<string | null>(null);
  const [manualEdit, setManualEdit] = useState<ManualEditState>(createDefaultManualEditState());
  const [manualHistory, setManualHistory] = useState<ManualEditState[]>([createDefaultManualEditState()]);
  const [manualHistoryIndex, setManualHistoryIndex] = useState(0);
  const [showManualTray, setShowManualTray] = useState(false);
  const [showFlashCam, setShowFlashCam] = useState(false);
  const manualTrayScrollRef = useRef<HTMLDivElement>(null);
  const bottomToolBarRef = useRef<HTMLDivElement>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const processingRunRef = useRef(0);
  const mediaSessionRef = useRef(0);
  const processingAbortRef = useRef<AbortController | null>(null);

  const invalidateActiveVideoWork = useCallback((resetUi = false) => {
    mediaSessionRef.current += 1;
    processingRunRef.current += 1;
    processingAbortRef.current?.abort();
    processingAbortRef.current = null;
    if (resetUi) {
      setIsEnhancing(false);
      setActiveTool(null);
    }
  }, []);

  void onNavigate;
  void originalFile;

  const releaseVideoAssets = useCallback(() => {
    for (const url of objectUrlsRef.current) {
      try {
        unregisterVideoAsset(url);
        URL.revokeObjectURL(url);
      } catch {
        // ignore cleanup failures
      }
    }
    objectUrlsRef.current = [];
  }, []);

  const resetVideoEditorUi = useCallback(() => {
    setOriginalFile(null);
    setOriginalFileName(null);
    reset(null);
    setPreviewThumbnail(null);
    setActiveTool(null);
    setShowHistory(false);
    const resetState = createDefaultManualEditState();
    setManualEdit(resetState);
    setManualHistory([resetState]);
    setManualHistoryIndex(0);
    setShowManualTray(false);
  }, [reset]);

  const clearVideoSession = useCallback(() => {
    invalidateActiveVideoWork(true);
    releaseVideoAssets();
    resetVideoEditorUi();
  }, [invalidateActiveVideoWork, releaseVideoAssets, resetVideoEditorUi]);

  const resetManualToolState = useCallback((options?: { closeTray?: boolean }) => {
    const resetState = createDefaultManualEditState();
    setManualEdit(resetState);
    setManualHistory([resetState]);
    setManualHistoryIndex(0);
    if (options?.closeTray) {
      setShowManualTray(false);
    }
  }, []);

  const prepareBeamRecordingForEditor = useCallback(async (videoUrl: string, fileName: string) => {
    if (fileName.toLowerCase().endsWith(".mp4")) {
      return { videoUrl, fileName };
    }

    try {
      const normalizedBlob = await exportVideo(videoUrl, "unlock");
      if (!normalizedBlob.size || !normalizedBlob.type.includes("mp4")) {
        return { videoUrl, fileName };
      }

      const normalizedUrl = URL.createObjectURL(normalizedBlob);
      try { URL.revokeObjectURL(videoUrl); } catch {}
      return {
        videoUrl: normalizedUrl,
        fileName: fileName.replace(/\.[^.]+$/, ".mp4"),
      };
    } catch (error) {
      console.warn("Beam Mode recording normalization failed", error);
      return { videoUrl, fileName };
    }
  }, []);

  useEffect(() => {
    const warm = () => {
      warmVideoProcessor().catch(() => undefined);
    };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const id = (window as any).requestIdleCallback(warm, { timeout: 1800 });
      return () => (window as any).cancelIdleCallback?.(id);
    }

    const timer = globalThis.setTimeout(warm, 900);

    return () => globalThis.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!file) {
      setPreviewThumbnail(null);
      return;
    }

    getVideoThumbnail(file)
      .then((thumbnail) => {
        if (!cancelled) setPreviewThumbnail(thumbnail);
      })
      .catch(() => {
        if (!cancelled) setPreviewThumbnail(null);
      });

    return () => {
      cancelled = true;
    };
  }, [file]);

  useEffect(() => {
    if (file && activeTool === "manual") {
      setShowManualTray(true);
      return;
    }

    if (!file || activeTool !== "manual") {
      setShowManualTray(false);
    }
  }, [activeTool, file]);

  useEffect(() => {
    if (!file || activeTool !== "manual") return;
    requestAnimationFrame(() => {
      manualTrayScrollRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [activeTool, file]);

  useEffect(() => () => {
    invalidateActiveVideoWork(true);
    releaseVideoAssets();
  }, [invalidateActiveVideoWork, releaseVideoAssets]);

  const onDrop = (acceptedFiles: File[]) => {
    const nextFile = acceptedFiles[0];
    if (!nextFile) return;

    clearVideoSession();

    const objectUrl = URL.createObjectURL(nextFile);
    objectUrlsRef.current.push(objectUrl);
    registerVideoAsset(objectUrl);
    setOriginalFile(objectUrl);
    setOriginalFileName(nextFile.name);
    reset(objectUrl, { type: "video", thumbnailUri: null });
    setActiveTool(null);
    const resetState = createDefaultManualEditState();
    setManualEdit(resetState);
    setManualHistory([resetState]);
    setManualHistoryIndex(0);
    setShowManualTray(false);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "video/*": [".mp4", ".mov", ".avi", ".webm", ".m4v"] },
    multiple: false,
  } as any);

  const freeTools = useMemo(() => [
    { id: "manual", icon: SlidersHorizontal, label: "Manual Edit", description: "Edit manually" },
    { id: "1tap", icon: Sparkles, label: "1-Tap Video Fix", description: "Instant enhance" },
  ], []);

  const premiumTools = useMemo(() => [
    { id: "flashcam", icon: Camera, label: "Beam Mode", description: "Low light camera" },
    { id: "light", icon: Sun, label: "Fix Lighting", description: "Adjust lighting" },
    { id: "pro", icon: Monitor, label: "Pro Look", description: "Professional enhance" },
      ], []);

  const commitManualState = (next: ManualEditState | ((prev: ManualEditState) => ManualEditState)) => {
    setManualEdit((prev) => {
      const resolved = normaliseManualEditState(typeof next === "function" ? next(prev) : next);
      setManualHistory((historyState) => {
        const sliced = historyState.slice(0, manualHistoryIndex + 1);
        const last = sliced[sliced.length - 1];
        if (JSON.stringify(last) === JSON.stringify(resolved)) return sliced;
        const updated = [...sliced, resolved];
        setManualHistoryIndex(updated.length - 1);
        return updated;
      });
      return resolved;
    });
  };

  const undoManualEdit = () => {
    setManualHistoryIndex((index) => {
      const nextIndex = Math.max(0, index - 1);
      setManualEdit(manualHistory[nextIndex] || createDefaultManualEditState());
      return nextIndex;
    });
  };

  const redoManualEdit = () => {
    setManualHistoryIndex((index) => {
      const nextIndex = Math.min(manualHistory.length - 1, index + 1);
      setManualEdit(manualHistory[nextIndex] || createDefaultManualEditState());
      return nextIndex;
    });
  };

  const handleProcess = async (action: string, sourceOverride?: string) => {
    const sourceUrl = sourceOverride || file;
    if (!sourceUrl || isEnhancing) return;
    const exportFilename = currentEntry?.filename || originalFileName || "chromancy-video.mp4";

    const runId = processingRunRef.current + 1;
    const mediaSessionId = mediaSessionRef.current;
    processingRunRef.current = runId;
    processingAbortRef.current?.abort();
    const controller = new AbortController();
    processingAbortRef.current = controller;
    setIsEnhancing(true);
    setActiveTool(action);
    if (action === "manual") {
      setShowManualTray(false);
    }

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    try {
      const resultUrl = await processVideo(sourceUrl, action, action === "manual" ? manualEdit : undefined, { signal: controller.signal });

      if (!resultUrl) {
        throw new Error("Processed video output was not created.");
      }

      if (processingRunRef.current !== runId || mediaSessionRef.current !== mediaSessionId || controller.signal.aborted) {
        try { URL.revokeObjectURL(resultUrl); } catch {}
        return;
      }

      registerVideoAsset(resultUrl);
      objectUrlsRef.current.push(resultUrl);
      setFile(resultUrl, { type: "video", thumbnailUri: null, filename: exportFilename });

      if (action === "manual") {
        resetManualToolState();
      }

      if (action === "pro") {
        toast.success("Pro Look video edit finished.");
      } else if (action === "manual") {
        toast.success("Manual video edit applied.");
      } else {
        toast.success("Video processed!");
      }
    } catch (error: any) {
      if (error?.name !== "AbortError") {
        console.error("Video processing failed", error);
        toast.error(error?.message || "Processing failed. Please try another video.");
      }
    } finally {
      if (processingAbortRef.current === controller) {
        processingAbortRef.current = null;
      }
      if (processingRunRef.current === runId && mediaSessionRef.current === mediaSessionId) {
        setIsEnhancing(false);
        setActiveTool(null);
      }
    }
  };

  const commitPendingManualEdit = useCallback(async () => {
    if (!file || activeTool !== "manual" || !hasPendingManualEdit(manualEdit) || isEnhancing) {
      return file;
    }

    const mediaSessionId = mediaSessionRef.current;
    const runId = processingRunRef.current + 1;
    processingRunRef.current = runId;
    processingAbortRef.current?.abort();
    const controller = new AbortController();
    processingAbortRef.current = controller;
    setIsEnhancing(true);
    setActiveTool("manual");
    setShowManualTray(false);

    try {
      const resultUrl = await processVideo(file, "manual", manualEdit, { signal: controller.signal });
      if (!resultUrl) throw new Error("Manual video edit could not be preserved.");
      if (processingRunRef.current !== runId || mediaSessionRef.current !== mediaSessionId || controller.signal.aborted) {
        try { URL.revokeObjectURL(resultUrl); } catch {}
        return null;
      }

      registerVideoAsset(resultUrl);
      objectUrlsRef.current.push(resultUrl);
      setFile(resultUrl, { type: "video", thumbnailUri: null, filename: currentEntry?.filename || originalFileName || "chromancy-video.mp4" });
      resetManualToolState({ closeTray: true });
      return resultUrl;
    } catch (error: any) {
      if (error?.name !== "AbortError") {
        console.error("Video manual edit commit failed", error);
        toast.error(error?.message || "Could not keep your manual video edit.");
      }
      return null;
    } finally {
      if (processingAbortRef.current === controller) {
        processingAbortRef.current = null;
      }
      if (processingRunRef.current === runId && mediaSessionRef.current === mediaSessionId) {
        setIsEnhancing(false);
        if (activeTool === "manual") {
          setActiveTool(null);
        }
      }
    }
  }, [activeTool, currentEntry?.filename, file, isEnhancing, manualEdit, originalFileName, resetManualToolState]);

  const handleToolSelection = useCallback(async (toolId: string) => {
    let sourceOverride: string | undefined;

    if (activeTool === "manual" && toolId !== "manual" && toolId !== "flashcam") {
      const committed = await commitPendingManualEdit();
      if (committed === null) return;
      sourceOverride = committed || undefined;
    }

    if (toolId === "manual") {
      setShowFlashCam(false);
      setShowHistory(false);
      setActiveTool("manual");
      setShowManualTray(true);
      requestAnimationFrame(() => {
        manualTrayScrollRef.current?.parentElement?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
      return;
    }

    setShowManualTray(false);

    if (toolId === "flashcam") {
      setShowFlashCam(true);
      setActiveTool("flashcam");
      return;
    }

    void handleProcess(toolId, sourceOverride);
  }, [activeTool, commitPendingManualEdit, handleProcess]);

  const handleExport = async () => {
    let exportSource = currentEntry?.uri || file || historyEntries[historyEntries.length - 1]?.uri || originalFile;
    if (!exportSource) return;

    if (activeTool === "manual" && hasPendingManualEdit(manualEdit)) {
      const committed = await commitPendingManualEdit();
      if (committed === null) return;
      exportSource = committed || exportSource;
    }

    const fileStem = (currentEntry?.filename || originalFileName || "chromancy-video").replace(/\.[^.]+$/, "") || "chromancy-video";
    const exportMode = getExportMode({ tier, usedPremium: false, category: "video" });

    try {
      if (exportMode !== "free") {
        const directResponse = await fetch(exportSource);
        if (!directResponse.ok) {
          throw new Error(`Export could not read the current video (${directResponse.status}).`);
        }
        const directBlob = await directResponse.blob();
        if (!directBlob.size) {
          throw new Error("Export produced an empty video file.");
        }
        const directExtension = directBlob.type.includes("webm")
          ? "webm"
          : directBlob.type.includes("quicktime")
            ? "mov"
            : directBlob.type.includes("mp4")
              ? "mp4"
              : (currentEntry?.filename || originalFileName || "chromancy-video.mp4").split(".").pop() || "mp4";
        await saveBlobToDevice(directBlob, `${fileStem}-${Date.now()}.${directExtension}`);
        toast.success("Export saved successfully.");
        return;
      }

      const blob = await exportVideo(exportSource, exportMode);
      const extension = blob.type.includes("webm") ? "webm" : blob.type.includes("quicktime") ? "mov" : "mp4";
      await saveBlobToDevice(blob, `${fileStem}-${Date.now()}.${extension}`);
      toast.success("Export saved successfully.");
    } catch (error: any) {
      console.error("Primary video export failed", error);

      if (exportMode === "free") {
        toast.error(error?.message || "Free export failed. Please try again.");
        return;
      }

      try {
        const fallbackResponse = await fetch(exportSource);
        if (!fallbackResponse.ok) {
          throw new Error(`Fallback export could not read the current video (${fallbackResponse.status}).`);
        }

        const fallbackBlob = await fallbackResponse.blob();
        if (!fallbackBlob.size) {
          throw new Error("Fallback export produced an empty video file.");
        }

        const fallbackExtension = fallbackBlob.type.includes("webm")
          ? "webm"
          : fallbackBlob.type.includes("quicktime")
            ? "mov"
            : fallbackBlob.type.includes("mp4")
              ? "mp4"
              : (currentEntry?.filename || originalFileName || "chromancy-video.mp4").split('.').pop() || "mp4";

        await saveBlobToDevice(fallbackBlob, `${fileStem}-${Date.now()}.${fallbackExtension}`);
        toast.success("Export saved successfully.");
      } catch (fallbackError: any) {
        console.error("Fallback video export failed", fallbackError);
        toast.error(fallbackError?.message || error?.message || "Export failed. Please check storage access and try again.");
      }
    }
  };

  const scrollManualTray = (direction: "up" | "down") => {
    manualTrayScrollRef.current?.scrollBy({
      top: direction === "up" ? -180 : 180,
      behavior: "smooth",
    });
  };

  const isManualPanelVisible = !!file && showManualTray && activeTool === "manual";

  if (showFlashCam) {
    return (
      <FlashCamStudio
        open={showFlashCam}
        onClose={() => {
          setShowFlashCam(false);
          if (activeTool === "flashcam") setActiveTool(null);
        }}
        onSave={async (videoUrl, fileName) => {
          setShowFlashCam(false);
          setActiveTool(null);
          clearVideoSession();
          const prepared = await prepareBeamRecordingForEditor(videoUrl, fileName);
          registerVideoAsset(prepared.videoUrl);
          objectUrlsRef.current.push(prepared.videoUrl);
          setOriginalFile(prepared.videoUrl);
          setOriginalFileName(prepared.fileName);
          setFile(prepared.videoUrl, { type: "video", thumbnailUri: null, filename: prepared.fileName, persistLocalHistory: true });
          resetManualToolState({ closeTray: true });
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-black">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/2">
        <div className="flex gap-4">
          <button onClick={undo} disabled={!canUndo} className="p-1 text-white/40 hover:text-white transition-colors disabled:opacity-20">
            <Undo2 className="w-5 h-5" />
          </button>
          <button onClick={redo} disabled={!canRedo} className="p-1 text-white/40 hover:text-white transition-colors disabled:opacity-20">
            <Redo2 className="w-5 h-5" />
          </button>
          <button onClick={() => setShowHistory(!showHistory)} className={cn("p-1 transition-colors", showHistory ? "text-white" : "text-white/40 hover:text-white")}>
            <History className="w-5 h-5" />
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            disabled={!(currentEntry?.uri || file || historyEntries[historyEntries.length - 1]?.uri || originalFile)}
            className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-xs font-bold uppercase tracking-widest hover:bg-white/20 transition-all disabled:opacity-20"
          >
            <Download className="w-3 h-3" />
            Export
          </button>
        </div>
      </div>

      <div className="visible-scrollbar flex-1 relative overflow-y-auto flex flex-col items-center p-4 pt-6 pr-2">
        <section className="w-full max-w-3xl space-y-2 text-center mb-4">
          <h2 className="text-2xl font-bold tracking-tight rainbow-text">{VIDEO_TAB_TITLE}</h2>
          <p className="text-sm text-white/50">{VIDEO_TAB_DESCRIPTION}</p>
        </section>
        {!file ? (
          <div
            {...getRootProps()}
            className={cn(
              "w-full max-w-md aspect-[3/4] rounded-3xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center p-8 text-center transition-all",
              isDragActive ? "bg-white/10 border-white/30" : "bg-white/5 hover:bg-white/10 hover:border-white/20",
            )}
          >
            <input {...getInputProps()} />
            <div className="p-6 rounded-full bg-white/5 mb-6">
              <Upload className="w-12 h-12 text-white/30" />
            </div>
            <h3 className="text-xl font-bold mb-2">Upload Video</h3>
            <p className="text-sm text-white/40 mb-8">MP4, MOV, AVI, M4V or WEBM supported.</p>
            <button className="px-8 py-3 rounded-full bg-white text-black font-bold uppercase tracking-widest hover:bg-white/90 transition-colors">
              Choose File
            </button>
          </div>
        ) : (
          <div className={cn("w-full flex flex-col gap-4", isManualPanelVisible ? "max-w-3xl" : "h-full")}>
            <div className={cn("relative rounded-3xl overflow-hidden bg-white/5 border border-white/10", isManualPanelVisible ? "h-[24vh] sm:h-[28vh]" : "min-h-[360px] flex-1")}>
              <div className="relative w-full h-full overflow-hidden">
                <PreviewRenderer
                  result={{ type: "video", uri: file, thumbnailUri: previewThumbnail }}
                  alt="Processed video"
                  controls
                  muted
                  loop
                  autoPlay={!isEnhancing}
                  className="w-full h-full object-contain"
                  style={isManualPanelVisible ? { filter: getManualFilterCss(manualEdit), transform: `rotate(${manualEdit.rotation}deg) scale(${100 / Math.max(manualEdit.cropWidth, manualEdit.cropHeight)})`, transformOrigin: "center center" } : undefined}
                />
                {isManualPanelVisible && (
                  <div className="pointer-events-none absolute inset-0 border border-white/15">
                    <div className="absolute border-2 border-white/80 rounded-xl" style={{ left: `${manualEdit.cropX}%`, top: `${manualEdit.cropY}%`, width: `${manualEdit.cropWidth}%`, height: `${manualEdit.cropHeight}%` }} />
                  </div>
                )}
              </div>

              {isEnhancing && (
                <div className="absolute inset-0 z-20 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
                  <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
                  <p className="text-sm font-bold uppercase tracking-widest animate-pulse">
                    {activeTool === "pro" ? "Building Pro Look..." : activeTool === "manual" ? "Applying Manual Edit..." : "Processing Video..."}
                  </p>
                </div>
              )}
            </div>

            <button
              onClick={() => {
                clearVideoSession();
              }}
              className="self-center flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/30 hover:text-white transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Replace Video
            </button>
          </div>
        )}
        {isManualPanelVisible && (
          <div className="w-full px-1 pb-4">
            <div className="mx-auto w-full max-w-md rounded-[1.75rem] border border-white/10 bg-black/84 backdrop-blur-xl shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.06] px-4 py-3 text-white/75">
                <div className="flex items-center gap-3">
                  <Scissors className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em]">Manual Edit</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => scrollManualTray("up")} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors" aria-label="Scroll up"><ChevronUp className="w-4 h-4" /></button>
                  <button onClick={() => scrollManualTray("down")} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors" aria-label="Scroll down"><ChevronDown className="w-4 h-4" /></button>
                  <button onClick={undoManualEdit} disabled={manualHistoryIndex === 0} className="p-1.5 rounded-lg bg-white/5 disabled:opacity-25 hover:bg-white/10 transition-colors"><Undo className="w-4 h-4" /></button>
                  <button onClick={redoManualEdit} disabled={manualHistoryIndex >= manualHistory.length - 1} className="p-1.5 rounded-lg bg-white/5 disabled:opacity-25 hover:bg-white/10 transition-colors"><Redo className="w-4 h-4" /></button>
                </div>
              </div>

              <div ref={manualTrayScrollRef} className="manual-scrollbar max-h-[48vh] overflow-y-auto p-4 pt-3 space-y-3">
                <div className="sticky top-0 z-20 -mx-4 -mt-3 mb-2 flex items-center justify-between gap-3 bg-gradient-to-b from-black via-black/95 to-black/80 px-4 pb-3 pt-3 text-white/75 backdrop-blur-sm">
                  <button onClick={() => handleProcess("manual")} disabled={!file || isEnhancing} className="w-[46%] min-w-[132px] py-2.5 rounded-xl bg-white text-black font-bold text-[10px] uppercase tracking-[0.16em] hover:bg-white/90 disabled:opacity-20 transition-all flex items-center justify-center gap-1.5">
                    <SparklesIcon className="w-4 h-4" />
                    <span>Apply edit</span>
                  </button>
                  <button onClick={() => { resetManualToolState({ closeTray: true }); setActiveTool(null); }} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-[0.18em] hover:bg-white/10 transition-colors">
                    Close tray
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                  <label className="space-y-2"><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Crop left</span><input type="range" min={0} max={95} value={manualEdit.cropX} onChange={(e) => commitManualState((prev) => ({ ...prev, cropX: Number(e.target.value) }))} className="block w-1/2 mx-auto" /></label>
                  <label className="space-y-2"><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Crop top</span><input type="range" min={0} max={95} value={manualEdit.cropY} onChange={(e) => commitManualState((prev) => ({ ...prev, cropY: Number(e.target.value) }))} className="block w-1/2 mx-auto" /></label>
                  <label className="space-y-2"><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Crop width</span><input type="range" min={5} max={100 - manualEdit.cropX} value={manualEdit.cropWidth} onChange={(e) => commitManualState((prev) => ({ ...prev, cropWidth: Number(e.target.value) }))} className="block w-1/2 mx-auto" /></label>
                  <label className="space-y-2"><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Crop height</span><input type="range" min={5} max={100 - manualEdit.cropY} value={manualEdit.cropHeight} onChange={(e) => commitManualState((prev) => ({ ...prev, cropHeight: Number(e.target.value) }))} className="block w-1/2 mx-auto" /></label>
                  <label className="space-y-2"><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Brightness</span><input type="range" min={0} max={200} value={manualEdit.brightness} onChange={(e) => commitManualState((prev) => ({ ...prev, brightness: Number(e.target.value) }))} className="block w-1/2 mx-auto" /></label>
                  <label className="space-y-2"><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Contrast</span><input type="range" min={0} max={200} value={manualEdit.contrast} onChange={(e) => commitManualState((prev) => ({ ...prev, contrast: Number(e.target.value) }))} className="block w-1/2 mx-auto" /></label>
                  <label className="space-y-2"><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Saturation</span><input type="range" min={0} max={200} value={manualEdit.saturation} onChange={(e) => commitManualState((prev) => ({ ...prev, saturation: Number(e.target.value) }))} className="block w-1/2 mx-auto" /></label>
                  <label className="space-y-2"><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Blur</span><input type="range" min={0} max={10} step={0.1} value={manualEdit.blur} onChange={(e) => commitManualState((prev) => ({ ...prev, blur: Number(e.target.value) }))} className="block w-1/2 mx-auto" /></label>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => commitManualState((prev) => ({ ...prev, rotation: (prev.rotation + 270) % 360 }))} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-[0.18em] hover:bg-white/10 transition-colors">Rotate Left</button>
                  <button onClick={() => commitManualState((prev) => ({ ...prev, rotation: (prev.rotation + 90) % 360 }))} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-[0.18em] hover:bg-white/10 transition-colors">Rotate Right</button>
                  <button onClick={() => { const resetState = createDefaultManualEditState(); setManualEdit(resetState); setManualHistory([resetState]); setManualHistoryIndex(0); }} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-[0.18em] hover:bg-white/10 transition-colors">Reset Manual</button>
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Filters</p>
                  <div className="visible-horizontal-scrollbar flex gap-1.5 overflow-x-auto pb-1">
                    {MANUAL_FILTERS.map((filter) => (
                      <button key={filter.id} onClick={() => commitManualState((prev) => ({ ...prev, filter: filter.id as ManualFilterId }))} className={cn("flex-shrink-0 px-3 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-[0.18em] transition-all", manualEdit.filter === filter.id ? "bg-white text-black border-white" : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10")}>{filter.label}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        <HistoryDrawer open={showHistory} title="Video history" items={historyEntries} currentItem={file} onClose={() => setShowHistory(false)} onSelect={selectHistory} />
      </div>

      <div ref={bottomToolBarRef} className="safe-area-bottom bg-black border-t border-white/10 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">Video Tools</span>
        </div>

        <div className="visible-horizontal-scrollbar flex gap-3 overflow-x-auto pb-2">
          {freeTools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => { void handleToolSelection(tool.id); }}
              className={cn(
                "flex-shrink-0 flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all min-w-[100px]",
                activeTool === tool.id ? "bg-white text-black border-white" : "bg-white/5 border-white/10 text-white hover:bg-white/10",
              )}
            >
              <tool.icon className="w-5 h-5" />
              <div className="text-center">
                <p className="text-[10px] font-bold uppercase leading-none">{tool.label}</p>
                <p className="text-[8px] opacity-50 mt-1">{tool.description}</p>
              </div>
            </button>
          ))}

          <div className="w-px h-12 bg-white/10 self-center" />

          {premiumTools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => { void handleToolSelection(tool.id); }}
              className={cn(
                "flex-shrink-0 flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all min-w-[100px]",
                activeTool === tool.id ? "bg-white text-black border-white" : "bg-white/5 border-white/10 text-white hover:bg-white/10",
              )}
            >
              <tool.icon className="w-5 h-5" />
              <div className="text-center">
                <p className="text-[10px] font-bold uppercase leading-none">{tool.label}</p>
                {tool.id === "flashcam" ? (
                  <p className={cn("mt-1 inline-flex rounded-full px-2 py-0.5 text-[7px] font-bold uppercase tracking-[0.16em]", activeTool === tool.id ? "bg-black/10 text-black/70" : "bg-white text-black")}>EXCLUSIVE</p>
                ) : null}
                <p className="text-[8px] opacity-50 mt-1">{tool.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
