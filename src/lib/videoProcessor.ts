type VideoAction = "light" | "1tap" | "pro" | "manual";

type ManualVideoFilterId = "none" | "natural" | "milk" | "blackwhite" | "warm" | "cool" | "cinema" | "pop" | "faded" | "mono" | "softglow";

type ManualVideoParams = {
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
  rotation?: number;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  blur?: number;
  filter?: ManualVideoFilterId;
};

type ProcessVideoOptions = {
  signal?: AbortSignal;
};

type FaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Point = { x: number; y: number };
type FaceGeometry = {
  box: FaceBox;
  oval: Point[];
  leftEye: Point[];
  rightEye: Point[];
  leftBrow: Point[];
  rightBrow: Point[];
  outerLips: Point[];
  innerLips: Point[];
  nose: Point[];
};

let ffmpegModulePromise: Promise<any> | null = null;
let ffmpegUtilPromise: Promise<any> | null = null;
let ffmpeg: any = null;
let loadPromise: Promise<any> | null = null;

const DEFAULT_MAX_PROCESS_WIDTH = 480;
const PRO_MAX_PROCESS_WIDTH = 540;
const TARGET_FPS = 8;
const FACE_REFRESH_MS = 2200;
const VIDEO_STALL_TIMEOUT_MS = 12000;
const VIDEO_ABSOLUTE_TIMEOUT_MS = 70000;
const MAX_FAST_EDIT_SECONDS = 55;
const MEDIAPIPE_VISION_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm";
const MEDIAPIPE_FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let mediaPipeInitPromise: Promise<any> | null = null;
let faceLandmarker: any = null;
let faceDetector: any = null;

const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const LEFT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const RIGHT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const LEFT_BROW = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
const RIGHT_BROW = [336, 296, 334, 293, 300, 285, 295, 282, 283, 276];
const OUTER_LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78];
const INNER_LIPS = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];
const NOSE = [168, 6, 197, 195, 5, 4, 1, 19, 94, 2, 164, 98, 97, 326, 327, 294, 278, 344, 440, 275, 45, 220, 115, 48, 64];

const MANUAL_VIDEO_FILTERS: Record<ManualVideoFilterId, { brightness?: number; contrast?: number; saturation?: number; blur?: number; grayscale?: number; sepia?: number; hueRotate?: number }> = {
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
};

function clampPct(value: number | undefined, min: number, max: number, fallback: number) {
  const n = Number.isFinite(value as number) ? Number(value) : fallback;
  return clamp(n, min, max);
}

function normaliseManualVideoParams(params: ManualVideoParams = {}): Required<ManualVideoParams> {
  const cropX = clampPct(params.cropX, 0, 95, 0);
  const cropY = clampPct(params.cropY, 0, 95, 0);
  const cropWidth = clampPct(params.cropWidth, 5, 100 - cropX, 100);
  const cropHeight = clampPct(params.cropHeight, 5, 100 - cropY, 100);
  return {
    cropX, cropY, cropWidth, cropHeight,
    rotation: clampPct(params.rotation, 0, 359, 0),
    brightness: clampPct(params.brightness, 0, 200, 100),
    contrast: clampPct(params.contrast, 0, 200, 100),
    saturation: clampPct(params.saturation, 0, 200, 100),
    blur: clampPct(params.blur, 0, 10, 0),
    filter: (params.filter || "none") as ManualVideoFilterId,
  };
}

function getManualVideoFilterString(params: ManualVideoParams = {}) {
  const safe = normaliseManualVideoParams(params);
  const preset = MANUAL_VIDEO_FILTERS[safe.filter] || {};
  const brightness = ((safe.brightness * (preset.brightness ?? 100)) / 100).toFixed(2);
  const contrast = ((safe.contrast * (preset.contrast ?? 100)) / 100).toFixed(2);
  const saturation = ((safe.saturation * (preset.saturation ?? 100)) / 100).toFixed(2);
  const blur = (safe.blur + (preset.blur ?? 0)).toFixed(2);
  const grayscale = (preset.grayscale ?? 0).toFixed(2);
  const sepia = (preset.sepia ?? 0).toFixed(2);
  const hueRotate = (preset.hueRotate ?? 0).toFixed(2);
  return `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) blur(${blur}px) grayscale(${grayscale}%) sepia(${sepia}%) hue-rotate(${hueRotate}deg)`;
}

function drawVideoFrameToSource(
  sourceCtx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
  params?: ManualVideoParams,
) {
  sourceCtx.clearRect(0, 0, width, height);
  const safe = normaliseManualVideoParams(params || {});
  const sx = Math.round((safe.cropX / 100) * video.videoWidth);
  const sy = Math.round((safe.cropY / 100) * video.videoHeight);
  const sw = Math.max(1, Math.round((safe.cropWidth / 100) * video.videoWidth));
  const sh = Math.max(1, Math.round((safe.cropHeight / 100) * video.videoHeight));
  const quarterTurns = ((((safe.rotation % 360) + 360) % 360) / 90) % 4;

  sourceCtx.save();
  sourceCtx.filter = getManualVideoFilterString(safe);
  sourceCtx.translate(width / 2, height / 2);
  sourceCtx.rotate((quarterTurns * Math.PI) / 2);
  const drawWidth = quarterTurns % 2 === 1 ? height : width;
  const drawHeight = quarterTurns % 2 === 1 ? width : height;
  sourceCtx.drawImage(video, sx, sy, sw, sh, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  sourceCtx.restore();
}

async function loadModules() {
  ffmpegModulePromise ??= import("@ffmpeg/ffmpeg");
  ffmpegUtilPromise ??= import("@ffmpeg/util");
  const [{ FFmpeg }, util] = await Promise.all([ffmpegModulePromise, ffmpegUtilPromise]);
  return { FFmpeg, ...util };
}

export async function getFFmpeg() {
  if (ffmpeg && (ffmpeg as any).__loaded) return ffmpeg;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const { FFmpeg, toBlobURL } = await loadModules();
    if (!ffmpeg) ffmpeg = new FFmpeg();

    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";

    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });

    (ffmpeg as any).__loaded = true;
    return ffmpeg;
  })();

  return loadPromise;
}

export async function warmVideoProcessor() {
  getReusableCanvas("video-warm", 64, 64);
  return null;
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Video processing cancelled.", "AbortError");
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getExposureProfile(sourceCanvas: HTMLCanvasElement, downsampleCanvas: HTMLCanvasElement) {
  const probeCtx = downsampleCanvas.getContext("2d", { willReadFrequently: true });
  if (!probeCtx) {
    return {
      brightness: 1.08,
      contrast: 1.08,
      saturate: 1.05,
      highlightRollOff: 0.08,
      shadowLift: 0.1,
      tintMode: "neutral" as const,
      tintStrength: 0,
    };
  }

  const probeWidth = Math.max(64, downsampleCanvas.width || 64);
  const probeHeight = Math.max(64, downsampleCanvas.height || 64);
  if (downsampleCanvas.width !== probeWidth) downsampleCanvas.width = probeWidth;
  if (downsampleCanvas.height !== probeHeight) downsampleCanvas.height = probeHeight;

  probeCtx.clearRect(0, 0, probeWidth, probeHeight);
  probeCtx.drawImage(sourceCanvas, 0, 0, probeWidth, probeHeight);

  const { data } = probeCtx.getImageData(0, 0, probeWidth, probeHeight);
  let avgLuma = 0;
  let shadowPixels = 0;
  let highlightPixels = 0;
  let warmBias = 0;
  const total = Math.max(1, data.length / 4);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    avgLuma += luma;
    if (luma < 0.34) shadowPixels += 1;
    if (luma > 0.78) highlightPixels += 1;
    warmBias += r - b;
  }

  avgLuma /= total;
  const shadowRatio = shadowPixels / total;
  const highlightRatio = highlightPixels / total;
  const darkBias = clamp((0.52 - avgLuma) / 0.24, 0, 1);
  const brightBias = clamp((avgLuma - 0.6) / 0.2, 0, 1);
  const warmth = warmBias / total;

  return {
    brightness: 1 + darkBias * 0.2 - brightBias * 0.08,
    contrast: 1.06 + darkBias * 0.08 + brightBias * 0.1,
    saturate: 1.02 + darkBias * 0.07 - brightBias * 0.01,
    highlightRollOff: clamp(0.06 + brightBias * 0.18 + highlightRatio * 0.12, 0.05, 0.3),
    shadowLift: clamp(0.08 + darkBias * 0.2 + shadowRatio * 0.08, 0.06, 0.28),
    tintMode: warmth > 0.035 ? "cool" as const : warmth < -0.03 ? "warm" as const : "neutral" as const,
    tintStrength: clamp(Math.abs(warmth) * 0.85 + Math.max(darkBias, brightBias) * 0.05, 0, 0.16),
  };
}

function applyExposureFinish(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  exposure: ReturnType<typeof getExposureProfile>,
) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = exposure.shadowLift;
  const lift = ctx.createLinearGradient(0, 0, 0, height);
  lift.addColorStop(0, "rgba(255,255,255,0.02)");
  lift.addColorStop(1, "rgba(255,255,255,0.18)");
  ctx.fillStyle = lift;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = exposure.highlightRollOff;
  ctx.fillStyle = "rgba(18,22,28,0.9)";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  if (exposure.tintMode !== "neutral" && exposure.tintStrength > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = exposure.tintStrength;
    const tint = ctx.createLinearGradient(0, 0, width, height);
    if (exposure.tintMode === "cool") {
      tint.addColorStop(0, "rgba(116,168,255,0.16)");
      tint.addColorStop(1, "rgba(255,255,255,0.02)");
    } else {
      tint.addColorStop(0, "rgba(255,214,146,0.16)");
      tint.addColorStop(1, "rgba(255,255,255,0.02)");
    }
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

function drawFreeExportWatermark(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const brandSize = Math.max(20, Math.round(Math.min(width, height) / 18));
  const paddingX = Math.max(14, Math.round(brandSize * 0.55));
  const paddingY = Math.max(10, Math.round(brandSize * 0.4));
  const margin = Math.max(16, Math.round(Math.min(width, height) * 0.028));

  ctx.save();
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  ctx.font = `800 ${brandSize}px Arial, sans-serif`;
  const brandWidth = ctx.measureText("CHROMANCY").width;
  const boxWidth = brandWidth + paddingX * 2;
  const boxHeight = brandSize + paddingY * 2;
  const x = width - boxWidth - margin;
  const y = height - boxHeight - margin;

  ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
  ctx.lineWidth = Math.max(1, Math.round(brandSize * 0.06));
  drawRoundedRect(ctx, x, y, boxWidth, boxHeight, Math.round(brandSize * 0.4));
  ctx.fill();
  ctx.stroke();

  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = Math.max(6, Math.round(brandSize * 0.24));
  ctx.shadowOffsetY = Math.max(2, Math.round(brandSize * 0.08));

  ctx.font = `800 ${brandSize}px Arial, sans-serif`;
  ctx.fillStyle = "rgba(255, 255, 255, 0.98)";
  ctx.fillText("CHROMANCY", x + paddingX, y + paddingY);

  ctx.restore();
}

const reusableCanvasPool = new Map<string, HTMLCanvasElement>();

function getReusableCanvas(key: string, width: number, height: number) {
  const existing = reusableCanvasPool.get(key) || createCanvas(Math.max(1, width), Math.max(1, height));
  if (existing.width !== width) existing.width = width;
  if (existing.height !== height) existing.height = height;
  reusableCanvasPool.set(key, existing);
  return existing;
}

async function loadVideo(videoUrl: string, options: ProcessVideoOptions = {}): Promise<HTMLVideoElement> {
  const { signal } = options;
  return await new Promise((resolve, reject) => {
    checkAbort(signal);
    const video = document.createElement("video");
    video.src = videoUrl;
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");

    const cleanup = () => {
      video.onloadedmetadata = null;
      video.oncanplay = null;
      video.onerror = null;
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      try { video.pause(); } catch {}
      reject(new DOMException("Video processing cancelled.", "AbortError"));
    };

    video.onloadedmetadata = () => {
      if (!Number.isFinite(video.duration) || video.videoWidth <= 0 || video.videoHeight <= 0) {
        return;
      }
      video.currentTime = 0;
      cleanup();
      resolve(video);
    };

    video.oncanplay = () => {
      if (!Number.isFinite(video.duration) || video.videoWidth <= 0 || video.videoHeight <= 0) {
        return;
      }
      video.currentTime = 0;
      cleanup();
      resolve(video);
    };

    video.onerror = () => {
      cleanup();
      reject(new Error("Unable to load video"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function loadImageAsset(imageUrl: string, options: ProcessVideoOptions = {}): Promise<HTMLImageElement> {
  const { signal } = options;
  return await new Promise((resolve, reject) => {
    checkAbort(signal);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";

    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Image animation cancelled.", "AbortError"));
    };

    image.onload = () => {
      cleanup();
      resolve(image);
    };

    image.onerror = () => {
      cleanup();
      reject(new Error("Unable to load image"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    image.src = imageUrl;
  });
}

async function seekVideo(video: HTMLVideoElement, time: number, options: ProcessVideoOptions = {}) {
  const { signal } = options;
  const clampedTime = Math.max(0, Math.min(time, Number.isFinite(video.duration) ? Math.max(video.duration - 0.01, 0) : time));

  return await new Promise<void>((resolve, reject) => {
    checkAbort(signal);

    const cleanup = () => {
      video.onseeked = null;
      video.onerror = null;
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Video inspection cancelled.", "AbortError"));
    };

    video.onseeked = () => {
      cleanup();
      resolve();
    };

    video.onerror = () => {
      cleanup();
      reject(new Error("Unable to inspect generated video"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    video.currentTime = clampedTime;
  });
}

async function detectPrimaryImageFocus(image: HTMLImageElement, width: number, height: number): Promise<FaceBox | null> {
  const FaceDetectorClass = (window as any).FaceDetector;
  if (!FaceDetectorClass) return null;

  faceDetector ??= new FaceDetectorClass({ fastMode: true, maxDetectedFaces: 1 });
  try {
    const faces = await faceDetector.detect(image);
    const face = faces?.[0];
    const box = face?.boundingBox;
    if (!box) return null;
    return {
      x: (box.x / Math.max(1, image.naturalWidth)) * width,
      y: (box.y / Math.max(1, image.naturalHeight)) * height,
      width: (box.width / Math.max(1, image.naturalWidth)) * width,
      height: (box.height / Math.max(1, image.naturalHeight)) * height,
    };
  } catch {
    return null;
  }
}

function drawAnimatedStillFrame(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  progress: number,
  focus: FaceBox | null,
) {
  const eased = 0.5 - Math.cos(progress * Math.PI) / 2;
  const sourceRatio = image.naturalWidth / Math.max(1, image.naturalHeight);
  const canvasRatio = width / Math.max(1, height);
  const baseScale = sourceRatio > canvasRatio
    ? height / Math.max(1, image.naturalHeight)
    : width / Math.max(1, image.naturalWidth);
  const motionScale = focus ? lerp(1.02, 1.12, eased) : lerp(1.01, 1.09, eased);
  const drawWidth = image.naturalWidth * baseScale * motionScale;
  const drawHeight = image.naturalHeight * baseScale * motionScale;

  const focusCenterX = focus ? focus.x + focus.width / 2 : width / 2;
  const focusCenterY = focus ? focus.y + focus.height / 2 : height / 2;
  const pullToCenterX = (width / 2 - focusCenterX) * 0.14;
  const pullToCenterY = (height / 2 - focusCenterY) * 0.14;
  const driftX = Math.sin(progress * Math.PI * 1.1) * width * 0.028 + pullToCenterX;
  const driftY = Math.cos(progress * Math.PI * 1.4) * height * 0.022 + pullToCenterY;
  const drawX = (width - drawWidth) / 2 + driftX;
  const drawY = (height - drawHeight) / 2 + driftY;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.18;
  const beamCenter = (-width * 0.25) + progress * width * 1.5;
  const beam = ctx.createLinearGradient(beamCenter - width * 0.24, 0, beamCenter + width * 0.24, 0);
  beam.addColorStop(0, "rgba(255,255,255,0)");
  beam.addColorStop(0.5, "rgba(255,255,255,0.28)");
  beam.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = beam;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  const vignette = ctx.createRadialGradient(width / 2, height / 2, width * 0.12, width / 2, height / 2, width * 0.78);
  vignette.addColorStop(0, "rgba(255,255,255,0.06)");
  vignette.addColorStop(1, "rgba(0,0,0,0.20)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

export async function hasMeaningfulVideoMotion(videoUrl: string, options: ProcessVideoOptions = {}): Promise<boolean> {
  const video = await loadVideo(videoUrl, options);
  const width = Math.max(1, Math.min(320, video.videoWidth));
  const height = Math.max(1, Math.round((width / Math.max(1, video.videoWidth)) * video.videoHeight));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!ctx) return true;

  const captureFrame = async (time: number) => {
    await seekVideo(video, time, options);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(video, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height).data;
  };

  const sampleTimes = [
    0,
    Math.max(0.2, video.duration * 0.4),
    Math.max(0.35, video.duration * 0.82),
  ];

  const first = await captureFrame(sampleTimes[0]);
  const middle = await captureFrame(sampleTimes[1]);
  const late = await captureFrame(sampleTimes[2]);
  const compare = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
    let totalDiff = 0;
    for (let i = 0; i < a.length; i += 16) {
      totalDiff += Math.abs(a[i] - b[i]);
      totalDiff += Math.abs(a[i + 1] - b[i + 1]);
      totalDiff += Math.abs(a[i + 2] - b[i + 2]);
    }
    return totalDiff / Math.max(1, a.length / 16);
  };

  const animated = compare(first, middle) > 7 || compare(first, late) > 9;
  try {
    video.pause();
    video.removeAttribute("src");
    video.load();
  } catch {}
  return animated;
}

export async function animateStillImage(imageUrl: string, options: ProcessVideoOptions = {}): Promise<string> {
  if (!(window as any).MediaRecorder || !(HTMLCanvasElement.prototype as any).captureStream) {
    throw new Error("Local image animation is not supported on this device.");
  }

  const image = await loadImageAsset(imageUrl, options);
  checkAbort(options.signal);

  const scaled = scaleDimensions(Math.max(1, image.naturalWidth), Math.max(1, image.naturalHeight), "pro");
  const width = Math.max(1, scaled.width);
  const height = Math.max(1, scaled.height);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    throw new Error("Animation canvas is not available.");
  }

  const focus = await detectPrimaryImageFocus(image, width, height);
  const stream = canvas.captureStream(Math.max(12, TARGET_FPS));
  const recorder = createFastVideoRecorder(new MediaStream([...stream.getVideoTracks()]), "pro");
  const chunks: BlobPart[] = [];
  const durationMs = 3600;
  let finished = false;
  let animationFrame = 0;
  let absoluteTimer = 0;

  const stopPromise = new Promise<Blob>((resolve, reject) => {
    const cleanup = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (absoluteTimer) window.clearTimeout(absoluteTimer);
      stream.getTracks().forEach((track) => track.stop());
    };

    const fail = (error: unknown) => {
      if (finished) return;
      finished = true;
      cleanup();
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {}
      reject(error instanceof Error ? error : new Error("Image animation failed."));
    };

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    recorder.onerror = (event: any) => {
      fail(event?.error || new Error("Image animation recording failed."));
    };

    recorder.onstop = () => {
      cleanup();
      const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
      if (!blob.size) {
        reject(new Error("Image animation produced an empty file."));
        return;
      }
      resolve(blob);
    };

    const startedAt = performance.now();
    const render = (now: number) => {
      if (finished) return;
      try {
        checkAbort(options.signal);
        const progress = clamp((now - startedAt) / durationMs, 0, 1);
        drawAnimatedStillFrame(ctx, image, width, height, progress, focus);
        if (progress >= 1) {
          finished = true;
          if (recorder.state !== "inactive") recorder.stop();
          return;
        }
        animationFrame = requestAnimationFrame(render);
      } catch (error) {
        fail(error);
      }
    };

    absoluteTimer = window.setTimeout(() => {
      fail(new Error("Image animation took too long and was stopped."));
    }, 12000);

    drawAnimatedStillFrame(ctx, image, width, height, 0, focus);
    recorder.start(250);
    animationFrame = requestAnimationFrame(render);
  });

  const blob = await stopPromise;
  const outputPath = URL.createObjectURL(blob);
  return await validatePlayableVideoUrl(outputPath);
}

function getPreferredRecorderMimeType() {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];

  for (const type of candidates) {
    if ((window as any).MediaRecorder?.isTypeSupported?.(type)) return type;
  }

  return "video/webm";
}

function createFastVideoRecorder(outputStream: MediaStream, action: VideoAction) {
  const videoBitsPerSecond = action === "pro" ? 2_800_000 : action === "1tap" ? 2_000_000 : action === "light" ? 1_700_000 : action === "manual" ? 1_900_000 : 2_100_000;
  const recorderOptions = {
    videoBitsPerSecond,
    audioBitsPerSecond: 96_000,
  };
  const preferredMimeType = getPreferredRecorderMimeType();

  try {
    return new MediaRecorder(outputStream, {
      mimeType: preferredMimeType,
      ...recorderOptions,
    });
  } catch (error) {
    console.warn("Preferred video recorder failed; falling back", error);
  }

  const fallbackMimeTypes = ["video/webm;codecs=vp8,opus", "video/webm", ""];
  for (const mimeType of fallbackMimeTypes) {
    try {
      return new MediaRecorder(outputStream, mimeType ? { mimeType, ...recorderOptions } : recorderOptions);
    } catch (error) {
      console.warn("Video recorder fallback failed", mimeType || "default", error);
    }
  }

  throw new Error("Video recording is not supported on this device.");
}

function scaleDimensions(width: number, height: number, action: VideoAction) {
  const maxWidth = action === "pro" ? PRO_MAX_PROCESS_WIDTH : DEFAULT_MAX_PROCESS_WIDTH;
  if (width <= maxWidth) return { width, height };
  const ratio = maxWidth / width;
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
}

function applyLighting(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "rgba(255,245,235,0.10)");
  gradient.addColorStop(1, "rgba(255,255,255,0.03)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function applyOneTapPolish(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.fillStyle = "rgba(255, 244, 225, 0.14)";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  const vignette = ctx.createRadialGradient(width / 2, height / 2, width * 0.15, width / 2, height / 2, width * 0.7);
  vignette.addColorStop(0, "rgba(255,255,255,0.06)");
  vignette.addColorStop(1, "rgba(0,0,0,0.12)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function applyProLook(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save();
  const teal = ctx.createLinearGradient(0, 0, width, height);
  teal.addColorStop(0, "rgba(18,94,102,0.10)");
  teal.addColorStop(0.55, "rgba(0,0,0,0)");
  teal.addColorStop(1, "rgba(208,138,82,0.09)");
  ctx.globalCompositeOperation = "color";
  ctx.fillStyle = teal;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  const lift = ctx.createLinearGradient(0, 0, 0, height);
  lift.addColorStop(0, "rgba(255,252,245,0.07)");
  lift.addColorStop(0.45, "rgba(255,246,232,0.03)");
  lift.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = lift;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "rgba(8,10,14,0.06)";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function applyPremiumNoiseControl(
  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  workCanvas: HTMLCanvasElement,
  downsampleCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  amount: number,
) {
  const workCtx = workCanvas.getContext("2d", { alpha: true });
  const downsampleCtx = downsampleCanvas.getContext("2d", { alpha: false });
  if (!workCtx || !downsampleCtx) return;

  downsampleCtx.clearRect(0, 0, downsampleCanvas.width, downsampleCanvas.height);
  downsampleCtx.filter = `blur(${0.4 + amount * 0.35}px)`;
  downsampleCtx.drawImage(sourceCanvas, 0, 0, downsampleCanvas.width, downsampleCanvas.height);
  downsampleCtx.filter = "none";

  workCtx.clearRect(0, 0, width, height);
  workCtx.filter = `blur(${0.2 + amount * 0.4}px)`;
  workCtx.drawImage(downsampleCanvas, 0, 0, downsampleCanvas.width, downsampleCanvas.height, 0, 0, width, height);
  workCtx.filter = "none";

  ctx.save();
  ctx.globalAlpha = 0.06 + amount * 0.05;
  ctx.drawImage(workCanvas, 0, 0, width, height);
  ctx.restore();
}

function applySoftSkinFinish(
  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  workCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  amount: number,
) {
  const workCtx = workCanvas.getContext("2d", { alpha: true });
  if (!workCtx) return;

  workCtx.clearRect(0, 0, width, height);
  workCtx.filter = `blur(${(0.65 + amount * 0.45).toFixed(2)}px) brightness(${(1.01 + amount * 0.03).toFixed(3)}) saturate(${(1.01 + amount * 0.04).toFixed(3)})`;
  workCtx.drawImage(sourceCanvas, 0, 0, width, height);
  workCtx.filter = "none";

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.08 + amount * 0.06;
  ctx.drawImage(workCanvas, 0, 0, width, height);
  ctx.restore();
}

function drawPolygonPath(ctx: CanvasRenderingContext2D, points: Point[]) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

function drawFaceGlow(
  ctx: CanvasRenderingContext2D,
  faces: FaceGeometry[],
  strength: number,
  tint = "255,244,236",
) {
  if (!faces.length) return;

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (const face of faces) {
    const cx = face.box.x + face.box.width / 2;
    const cy = face.box.y + face.box.height * 0.45;
    const radius = Math.max(face.box.width, face.box.height) * 0.9;
    const glow = ctx.createRadialGradient(cx, cy, radius * 0.12, cx, cy, radius);
    glow.addColorStop(0, `rgba(${tint},${strength})`);
    glow.addColorStop(0.58, `rgba(${tint},${strength * 0.42})`);
    glow.addColorStop(1, `rgba(${tint},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(face.box.x - radius * 0.4, face.box.y - radius * 0.5, face.box.width + radius * 0.8, face.box.height + radius * 0.9);
  }
  ctx.restore();
}

function drawFaceLift(
  ctx: CanvasRenderingContext2D,
  faces: FaceGeometry[],
  width: number,
  height: number,
  intensity: number,
) {
  if (!faces.length) return;

  const faceMask = createCanvas(width, height);
  const faceMaskCtx = faceMask.getContext("2d", { alpha: true });
  if (!faceMaskCtx) return;

  faceMaskCtx.fillStyle = "rgba(255,255,255,1)";
  for (const face of faces) {
    const expanded = face.oval.map((point) => ({
      x: point.x + (point.x - (face.box.x + face.box.width / 2)) * 0.08,
      y: point.y + (point.y - (face.box.y + face.box.height / 2)) * 0.12,
    }));
    drawPolygonPath(faceMaskCtx, expanded);
    faceMaskCtx.fill();
  }

  const blurredMask = createCanvas(width, height);
  const blurredCtx = blurredMask.getContext("2d", { alpha: true });
  if (!blurredCtx) return;
  blurredCtx.filter = "blur(18px)";
  blurredCtx.drawImage(faceMask, 0, 0);

  const overlay = createCanvas(width, height);
  const overlayCtx = overlay.getContext("2d", { alpha: true });
  if (!overlayCtx) return;

  overlayCtx.filter = `brightness(${1 + intensity * 0.12}) contrast(${1 + intensity * 0.08}) saturate(${1 + intensity * 0.05})`;
  overlayCtx.drawImage(ctx.canvas, 0, 0, width, height);
  overlayCtx.filter = "none";
  overlayCtx.globalCompositeOperation = "destination-in";
  overlayCtx.drawImage(blurredMask, 0, 0);

  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.drawImage(overlay, 0, 0);
  ctx.restore();

  drawFaceGlow(ctx, faces, 0.12 + intensity * 0.04);
}

function applyGlobalPolish(ctx: CanvasRenderingContext2D, width: number, height: number, amount: number) {
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.fillStyle = `rgba(255,246,232,${0.08 + amount * 0.04})`;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  const centerGlow = ctx.createRadialGradient(width / 2, height / 2, width * 0.08, width / 2, height / 2, width * 0.78);
  centerGlow.addColorStop(0, `rgba(255,255,255,${0.05 + amount * 0.02})`);
  centerGlow.addColorStop(0.58, "rgba(255,255,255,0.01)");
  centerGlow.addColorStop(1, `rgba(0,0,0,${0.10 + amount * 0.03})`);
  ctx.fillStyle = centerGlow;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function drawDetailBoost(
  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  amount: number,
) {
  const detailCanvas = createCanvas(width, height);
  const detailCtx = detailCanvas.getContext("2d", { alpha: true });
  if (!detailCtx) return;

  detailCtx.filter = `contrast(${1.04 + amount * 0.03}) saturate(${1.02 + amount * 0.02})`;
  detailCtx.drawImage(sourceCanvas, 0, 0, width, height);
  detailCtx.filter = "blur(0.8px)";
  detailCtx.globalCompositeOperation = "difference";
  detailCtx.drawImage(sourceCanvas, 0, 0, width, height);

  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = 0.16 + amount * 0.06;
  ctx.drawImage(detailCanvas, 0, 0, width, height);
  ctx.restore();
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function smoothFaces(previous: FaceGeometry[], next: FaceGeometry[]) {
  if (!previous.length) return next;
  return next.map((face, index) => {
    const prev = previous[index] || previous[0];
    return {
      box: {
        x: lerp(prev.box.x, face.box.x, 0.34),
        y: lerp(prev.box.y, face.box.y, 0.34),
        width: lerp(prev.box.width, face.box.width, 0.34),
        height: lerp(prev.box.height, face.box.height, 0.34),
      },
      oval: smoothPoints(prev.oval, face.oval, 0.34),
      leftEye: smoothPoints(prev.leftEye, face.leftEye, 0.34),
      rightEye: smoothPoints(prev.rightEye, face.rightEye, 0.34),
      leftBrow: smoothPoints(prev.leftBrow, face.leftBrow, 0.34),
      rightBrow: smoothPoints(prev.rightBrow, face.rightBrow, 0.34),
      outerLips: smoothPoints(prev.outerLips, face.outerLips, 0.34),
      innerLips: smoothPoints(prev.innerLips, face.innerLips, 0.34),
      nose: smoothPoints(prev.nose, face.nose, 0.34),
    } satisfies FaceGeometry;
  });
}

function smoothPoints(previous: Point[], next: Point[], amount: number) {
  if (!previous.length || previous.length !== next.length) return next;
  return next.map((point, index) => ({
    x: lerp(previous[index].x, point.x, amount),
    y: lerp(previous[index].y, point.y, amount),
  }));
}

function pointsFromIndices(landmarks: any[], indices: number[], width: number, height: number): Point[] {
  return indices
    .map((index) => landmarks[index])
    .filter(Boolean)
    .map((landmark) => ({
      x: landmark.x * width,
      y: landmark.y * height,
    }));
}

function createEllipsePoints(cx: number, cy: number, rx: number, ry: number, count = 18): Point[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
    return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
  });
}

function buildApproximateFaceGeometry(box: FaceBox): FaceGeometry {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return {
    box,
    oval: createEllipsePoints(cx, cy, box.width * 0.56, box.height * 0.72, 28),
    leftEye: createEllipsePoints(cx - box.width * 0.18, cy - box.height * 0.10, box.width * 0.10, box.height * 0.05, 12),
    rightEye: createEllipsePoints(cx + box.width * 0.18, cy - box.height * 0.10, box.width * 0.10, box.height * 0.05, 12),
    leftBrow: createEllipsePoints(cx - box.width * 0.18, cy - box.height * 0.18, box.width * 0.13, box.height * 0.04, 10),
    rightBrow: createEllipsePoints(cx + box.width * 0.18, cy - box.height * 0.18, box.width * 0.13, box.height * 0.04, 10),
    outerLips: createEllipsePoints(cx, cy + box.height * 0.23, box.width * 0.17, box.height * 0.07, 14),
    innerLips: createEllipsePoints(cx, cy + box.height * 0.23, box.width * 0.09, box.height * 0.04, 12),
    nose: createEllipsePoints(cx, cy + box.height * 0.03, box.width * 0.08, box.height * 0.13, 12),
  };
}

function buildFaceGeometry(landmarks: any[], width: number, height: number): FaceGeometry | null {
  if (!landmarks?.length) return null;

  const oval = pointsFromIndices(landmarks, FACE_OVAL, width, height);
  const leftEye = pointsFromIndices(landmarks, LEFT_EYE, width, height);
  const rightEye = pointsFromIndices(landmarks, RIGHT_EYE, width, height);
  const leftBrow = pointsFromIndices(landmarks, LEFT_BROW, width, height);
  const rightBrow = pointsFromIndices(landmarks, RIGHT_BROW, width, height);
  const outerLips = pointsFromIndices(landmarks, OUTER_LIPS, width, height);
  const innerLips = pointsFromIndices(landmarks, INNER_LIPS, width, height);
  const nose = pointsFromIndices(landmarks, NOSE, width, height);

  const xs = oval.map((p) => p.x);
  const ys = oval.map((p) => p.y);
  if (!xs.length || !ys.length) return null;

  return {
    box: {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    },
    oval,
    leftEye,
    rightEye,
    leftBrow,
    rightBrow,
    outerLips,
    innerLips,
    nose,
  };
}

async function detectFaces(video: HTMLVideoElement, width: number, height: number, _nowMs: number): Promise<FaceGeometry[]> {
  const FaceDetectorClass = (window as any).FaceDetector;
  if (!FaceDetectorClass) return [];

  faceDetector ??= new FaceDetectorClass({ fastMode: true, maxDetectedFaces: 2 });
  try {
    const faces = await faceDetector.detect(video);
    return faces.map((face: any) => {
      const box = face.boundingBox;
      const scaledBox = {
        x: (box.x / video.videoWidth) * width,
        y: (box.y / video.videoHeight) * height,
        width: (box.width / video.videoWidth) * width,
        height: (box.height / video.videoHeight) * height,
      };
      return buildApproximateFaceGeometry(scaledBox);
    });
  } catch {
    return [];
  }
}


function drawPolygon(ctx: CanvasRenderingContext2D, points: Point[]) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

function featherMask(maskCanvas: HTMLCanvasElement, tempCanvas: HTMLCanvasElement, blurPx = 12) {
  const tctx = tempCanvas.getContext("2d", { alpha: true });
  const mctx = maskCanvas.getContext("2d", { alpha: true });
  if (!tctx || !mctx) return;
  tempCanvas.width = maskCanvas.width;
  tempCanvas.height = maskCanvas.height;
  tctx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
  tctx.filter = `blur(${blurPx}px)`;
  tctx.drawImage(maskCanvas, 0, 0);
  mctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  mctx.drawImage(tempCanvas, 0, 0);
}

function carveEllipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function carveFeaturePolygon(ctx: CanvasRenderingContext2D, points: Point[], cx: number, cy: number, expandX: number, expandY: number, alpha = 1) {
  if (!points.length) return;
  const carved = points.map((point) => ({
    x: point.x + (point.x - cx) * expandX,
    y: point.y + (point.y - cy) * expandY,
  }));
  ctx.globalAlpha = alpha;
  drawPolygon(ctx, carved);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function mixWithPreviousMask(maskCanvas: HTMLCanvasElement, previousMaskCanvas: HTMLCanvasElement | null | undefined, width: number, height: number) {
  if (!previousMaskCanvas) return;
  const maskCtx = maskCanvas.getContext("2d", { alpha: true });
  if (!maskCtx) return;
  maskCtx.save();
  maskCtx.globalCompositeOperation = "source-over";
  maskCtx.globalAlpha = 0.28;
  maskCtx.drawImage(previousMaskCanvas, 0, 0, width, height);
  maskCtx.restore();
}

function buildSkinMask(maskCanvas: HTMLCanvasElement, tempCanvas: HTMLCanvasElement, faces: FaceGeometry[], width: number, height: number, previousMaskCanvas?: HTMLCanvasElement | null) {
  const maskCtx = maskCanvas.getContext("2d", { alpha: true });
  if (!maskCtx) return;

  maskCanvas.width = width;
  maskCanvas.height = height;
  maskCtx.clearRect(0, 0, width, height);
  maskCtx.fillStyle = "rgba(255,255,255,1)";

  for (const face of faces) {
    if (!face.oval.length) continue;

    const cx = face.box.x + face.box.width / 2;
    const cy = face.box.y + face.box.height / 2;
    const expandedOval = face.oval.map((point) => ({
      x: point.x + (point.x - cx) * 0.04,
      y: point.y + (point.y - cy) * (point.y < cy ? 0.015 : 0.05),
    }));

    maskCtx.save();
    drawPolygon(maskCtx, expandedOval);
    maskCtx.fill();
    maskCtx.restore();

    maskCtx.save();
    maskCtx.globalCompositeOperation = "destination-out";
    carveFeaturePolygon(maskCtx, face.leftEye, cx, cy, 0.90, 1.10, 1);
    carveFeaturePolygon(maskCtx, face.rightEye, cx, cy, 0.90, 1.10, 1);
    carveFeaturePolygon(maskCtx, face.leftBrow, cx, cy, 0.85, 1.05, 1);
    carveFeaturePolygon(maskCtx, face.rightBrow, cx, cy, 0.85, 1.05, 1);
    carveFeaturePolygon(maskCtx, face.outerLips, cx, cy, 0.35, 0.40, 1);
    carveFeaturePolygon(maskCtx, face.innerLips, cx, cy, 0.42, 0.50, 1);
    carveFeaturePolygon(maskCtx, face.nose, cx, cy, 0.10, 0.18, 0.52);
    carveEllipse(maskCtx, cx, face.box.y + face.box.height * 0.015, face.box.width * 0.46, face.box.height * 0.17, 1);
    carveEllipse(maskCtx, cx, face.box.y + face.box.height * 0.17, face.box.width * 0.34, face.box.height * 0.07, 0.94);
    carveEllipse(maskCtx, cx, face.box.y + face.box.height * 0.90, face.box.width * 0.34, face.box.height * 0.18, 0.92);
    carveEllipse(maskCtx, cx, face.box.y + face.box.height * 0.98, face.box.width * 0.25, face.box.height * 0.10, 0.86);
    carveEllipse(maskCtx, cx, face.box.y + face.box.height * 0.04, face.box.width * 0.30, face.box.height * 0.06, 0.64);
    maskCtx.restore();
  }

  featherMask(maskCanvas, tempCanvas, 2.6);
  mixWithPreviousMask(maskCanvas, previousMaskCanvas, width, height);
  featherMask(maskCanvas, tempCanvas, 3.4);
}

function refineSkinMaskByColor(
  maskCanvas: HTMLCanvasElement,
  tempCanvas: HTMLCanvasElement,
  sourceCanvas: HTMLCanvasElement,
  faces: FaceGeometry[],
  width: number,
  height: number,
) {
  const maskCtx = maskCanvas.getContext("2d", { alpha: true });
  const sourceCtx = sourceCanvas.getContext("2d", { alpha: false, willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
  if (!maskCtx || !sourceCtx || !faces.length) return;

  const frame = sourceCtx.getImageData(0, 0, width, height);
  const alpha = maskCtx.getImageData(0, 0, width, height);
  const data = frame.data;
  const out = alpha.data;

  for (const face of faces) {
    const x0 = Math.max(0, Math.floor(face.box.x - face.box.width * 0.08));
    const y0 = Math.max(0, Math.floor(face.box.y - face.box.height * 0.04));
    const x1 = Math.min(width, Math.ceil(face.box.x + face.box.width * 1.08));
    const y1 = Math.min(height, Math.ceil(face.box.y + face.box.height * 1.02));
    const cx = face.box.x + face.box.width / 2;
    const cy = face.box.y + face.box.height / 2;
    const rx = face.box.width * 0.60;
    const ry = face.box.height * 0.74;

    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const dx = (x - cx) / Math.max(1, rx);
        const dy = (y - cy) / Math.max(1, ry);
        if (dx * dx + dy * dy > 1.05) continue;
        const i = (y * width + x) * 4;
        if (out[i + 3] < 10) continue;

        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const maxv = Math.max(r, g, b);
        const minv = Math.min(r, g, b);
        const chroma = maxv - minv;
        const yv = 0.299 * r + 0.587 * g + 0.114 * b;
        const cr = (r - yv) * 0.713 + 128;
        const cb = (b - yv) * 0.564 + 128;

        const rgbSkin = r > 52 && g > 34 && b > 20 && chroma > 10 && r >= g && r > b * 0.86;
        const yccSkin = cb >= 76 && cb <= 132 && cr >= 133 && cr <= 176;
        const hsvLike = yv > 45 && yv < 242 && r > b && g > b * 0.75;
        const likelySkin = (rgbSkin && hsvLike) || (yccSkin && hsvLike);

        if (!likelySkin) {
          out[i + 3] = 0;
          continue;
        }

        const softnessX = Math.abs(dx);
        const softnessY = Math.abs(dy);
        const radialFalloff = clamp(1 - (softnessX * softnessX * 0.5 + softnessY * softnessY * 0.75), 0, 1);
        out[i + 3] = Math.round(out[i + 3] * radialFalloff);
      }
    }
  }

  maskCtx.putImageData(alpha, 0, 0);
  featherMask(maskCanvas, tempCanvas, 4);
}

function cloneCanvas(source: HTMLCanvasElement, width: number, height: number) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d", { alpha: true });
  if (ctx) ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

function getFaceProcessingRegion(faces: FaceGeometry[], width: number, height: number) {
  if (!faces.length) return { x: 0, y: 0, width, height };
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (const face of faces) {
    const padX = face.box.width * 0.24;
    const padY = face.box.height * 0.22;
    minX = Math.min(minX, face.box.x - padX);
    minY = Math.min(minY, face.box.y - padY);
    maxX = Math.max(maxX, face.box.x + face.box.width + padX);
    maxY = Math.max(maxY, face.box.y + face.box.height + padY);
  }
  const x = Math.max(0, Math.floor(minX));
  const y = Math.max(0, Math.floor(minY));
  const w = Math.min(width - x, Math.max(1, Math.ceil(maxX) - x));
  const h = Math.min(height - y, Math.max(1, Math.ceil(maxY) - y));
  return { x, y, width: w, height: h };
}

function createScaledImageData(image: ImageData, targetWidth: number, targetHeight: number) {
  const srcCanvas = createCanvas(image.width, image.height);
  const srcCtx = srcCanvas.getContext("2d", { alpha: true });
  if (!srcCtx) return image;
  srcCtx.putImageData(image, 0, 0);
  const scaledCanvas = createCanvas(targetWidth, targetHeight);
  const scaledCtx = scaledCanvas.getContext("2d", { alpha: true });
  if (!scaledCtx) return image;
  scaledCtx.imageSmoothingEnabled = true;
  scaledCtx.clearRect(0, 0, targetWidth, targetHeight);
  scaledCtx.drawImage(srcCanvas, 0, 0, targetWidth, targetHeight);
  return scaledCtx.getImageData(0, 0, targetWidth, targetHeight);
}

function putScaledImageData(ctx: CanvasRenderingContext2D, image: ImageData, x: number, y: number, width: number, height: number) {
  const sourceCanvas = createCanvas(image.width, image.height);
  const sourceCtx = sourceCanvas.getContext("2d", { alpha: true });
  if (!sourceCtx) return;
  sourceCtx.putImageData(image, 0, 0);
  ctx.drawImage(sourceCanvas, x, y, width, height);
}

function getRedPinkWeight(r: number, g: number, b: number) {
  const maxv = Math.max(r, g, b);
  const minv = Math.min(r, g, b);
  const delta = maxv - minv;
  if (delta < 4) return 0;
  let hue = 0;
  if (maxv === r) hue = ((g - b) / delta) % 6;
  else if (maxv === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  const sat = delta / Math.max(1, maxv);
  const redBand = Math.max(0, 1 - Math.min(Math.abs(hue - 350), Math.abs(hue - 10)) / 26);
  const pinkBand = Math.max(0, 1 - Math.abs(hue - 330) / 34);
  return Math.max(redBand, pinkBand) * clamp((sat - 0.08) / 0.42, 0, 1);
}

function getNeutralWhiteWeight(r: number, g: number, b: number) {
  const maxv = Math.max(r, g, b);
  const minv = Math.min(r, g, b);
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const saturation = (maxv - minv) / Math.max(1, maxv);
  const neutrality = 1 - clamp(saturation / 0.24, 0, 1);
  return clamp((luma - 0.68) / 0.22, 0, 1) * neutrality;
}

function computeSkinAdaptiveStrength(face: FaceGeometry, width: number, height: number) {
  const faceCoverage = (face.box.width * face.box.height) / Math.max(1, width * height);
  if (faceCoverage < 0.035) return 0.98;
  if (faceCoverage < 0.09) return 0.86;
  return 0.74;
}

function buildDetailProtectionMask(protectionCanvas: HTMLCanvasElement, blurCanvas: HTMLCanvasElement, faces: FaceGeometry[], width: number, height: number) {
  const ctx = protectionCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;
  protectionCanvas.width = width;
  protectionCanvas.height = height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,1)";

  for (const face of faces) {
    const cx = face.box.x + face.box.width / 2;
    const cy = face.box.y + face.box.height / 2;
    carveFeaturePolygon(ctx, face.leftEye, cx, cy, 0.72, 0.92, 1);
    carveFeaturePolygon(ctx, face.rightEye, cx, cy, 0.72, 0.92, 1);
    carveFeaturePolygon(ctx, face.leftBrow, cx, cy, 0.65, 0.90, 1);
    carveFeaturePolygon(ctx, face.rightBrow, cx, cy, 0.65, 0.90, 1);
    carveFeaturePolygon(ctx, face.outerLips, cx, cy, 0.18, 0.24, 1);
    carveFeaturePolygon(ctx, face.innerLips, cx, cy, 0.22, 0.28, 1);
    carveFeaturePolygon(ctx, face.nose, cx, cy, 0.05, 0.10, 0.78);
    carveEllipse(ctx, cx, face.box.y + face.box.height * 0.90, face.box.width * 0.30, face.box.height * 0.16, 0.86);
    carveEllipse(ctx, cx, face.box.y + face.box.height * 0.03, face.box.width * 0.26, face.box.height * 0.05, 0.72);
  }

  featherMask(protectionCanvas, blurCanvas, 2.4);
}

function applyFrequencySeparatedSkinSmoothing(
  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  workCanvas: HTMLCanvasElement,
  detailCanvas: HTMLCanvasElement,
  protectionCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  faces: FaceGeometry[],
) {
  const workCtx = workCanvas.getContext("2d", { alpha: true });
  const detailCtx = detailCanvas.getContext("2d", { alpha: true });
  if (!workCtx || !detailCtx) return;

  const adaptiveStrength = faces.length
    ? Math.max(...faces.map((face) => computeSkinAdaptiveStrength(face, width, height)))
    : 0.82;

  workCanvas.width = width;
  workCanvas.height = height;
  workCtx.clearRect(0, 0, width, height);
  workCtx.filter = `blur(${4.8 + adaptiveStrength * 2.2}px) brightness(${1.10 + adaptiveStrength * 0.10}) contrast(${0.94 - adaptiveStrength * 0.04}) saturate(${0.98 - adaptiveStrength * 0.03})`;
  workCtx.drawImage(sourceCanvas, 0, 0, width, height);
  workCtx.filter = "none";
  workCtx.globalCompositeOperation = "destination-in";
  workCtx.drawImage(maskCanvas, 0, 0, width, height);
  workCtx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.globalAlpha = 0.54 + adaptiveStrength * 0.12;
  ctx.drawImage(workCanvas, 0, 0, width, height);
  ctx.restore();

  detailCanvas.width = width;
  detailCanvas.height = height;
  detailCtx.clearRect(0, 0, width, height);
  detailCtx.drawImage(sourceCanvas, 0, 0, width, height);
  detailCtx.globalCompositeOperation = "difference";
  detailCtx.filter = "blur(1.15px)";
  detailCtx.drawImage(sourceCanvas, 0, 0, width, height);
  detailCtx.filter = "none";
  detailCtx.globalCompositeOperation = "destination-in";
  detailCtx.drawImage(maskCanvas, 0, 0, width, height);
  detailCtx.globalCompositeOperation = "destination-out";
  detailCtx.drawImage(protectionCanvas, 0, 0, width, height);
  detailCtx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = 0.12 + adaptiveStrength * 0.06;
  ctx.drawImage(detailCanvas, 0, 0, width, height);
  ctx.restore();
}

function drawSharpenPass(

  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  amount: number,
) {
  const blurCanvas = createCanvas(width, height);
  const blurCtx = blurCanvas.getContext("2d", { alpha: true });
  if (!blurCtx) return;

  blurCtx.filter = `blur(${0.8 + amount * 0.9}px)`;
  blurCtx.drawImage(sourceCanvas, 0, 0, width, height);

  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.22 + amount * 0.18;
  ctx.drawImage(sourceCanvas, 0, 0, width, height);
  ctx.globalCompositeOperation = "difference";
  ctx.globalAlpha = 0.05 + amount * 0.04;
  ctx.drawImage(blurCanvas, 0, 0, width, height);
  ctx.restore();
}

function drawMaskedFilteredOverlay(
  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  filter: string,
  alpha: number,
) {
  const overlayCanvas = getReusableCanvas(`masked-overlay-${width}x${height}`, width, height);
  const overlayCtx = overlayCanvas.getContext("2d", { alpha: true });
  if (!overlayCtx) return;

  overlayCtx.clearRect(0, 0, width, height);
  overlayCtx.filter = filter;
  overlayCtx.drawImage(sourceCanvas, 0, 0, width, height);
  overlayCtx.filter = "none";
  overlayCtx.globalCompositeOperation = "destination-in";
  overlayCtx.drawImage(maskCanvas, 0, 0);
  overlayCtx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(overlayCanvas, 0, 0, width, height);
  ctx.restore();
}

function drawExpandedFaceMask(
  maskCanvas: HTMLCanvasElement,
  tempCanvas: HTMLCanvasElement,
  faces: FaceGeometry[],
  width: number,
  height: number,
) {
  const maskCtx = maskCanvas.getContext("2d", { alpha: true });
  if (!maskCtx) return;

  maskCanvas.width = width;
  maskCanvas.height = height;
  maskCtx.clearRect(0, 0, width, height);
  maskCtx.fillStyle = "rgba(255,255,255,1)";

  for (const face of faces) {
    const cx = face.box.x + face.box.width / 2;
    const cy = face.box.y + face.box.height / 2;
    const expanded = face.oval.length
      ? face.oval.map((point) => ({
          x: point.x + (point.x - cx) * 0.14,
          y: point.y + (point.y - cy) * 0.18,
        }))
      : [];

    if (expanded.length) {
      drawPolygon(maskCtx, expanded);
      maskCtx.fill();
    } else {
      maskCtx.beginPath();
      maskCtx.ellipse(cx, cy, face.box.width * 0.62, face.box.height * 0.78, 0, 0, Math.PI * 2);
      maskCtx.fill();
    }
  }

  featherMask(maskCanvas, tempCanvas, 7);
}

function drawGlobalBeautyFallback(
  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  workCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  amount: number,
) {
  const workCtx = workCanvas.getContext("2d", { alpha: true });
  if (!workCtx) {
    ctx.drawImage(sourceCanvas, 0, 0, width, height);
    return;
  }

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.filter = `brightness(${1.08 + amount * 0.09}) contrast(${1.08 + amount * 0.07}) saturate(${1.04 + amount * 0.05})`;
  ctx.drawImage(sourceCanvas, 0, 0, width, height);
  ctx.restore();

  workCanvas.width = width;
  workCanvas.height = height;
  workCtx.clearRect(0, 0, width, height);
  workCtx.filter = `blur(${8 + amount * 4.5}px) brightness(${1.08 + amount * 0.06}) contrast(${0.90 - amount * 0.03})`;
  workCtx.drawImage(sourceCanvas, 0, 0, width, height);
  workCtx.filter = "none";

  ctx.save();
  ctx.globalAlpha = 0.42 + amount * 0.24;
  ctx.drawImage(workCanvas, 0, 0, width, height);
  ctx.restore();

  applyGlobalPolish(ctx, width, height, 0.7 + amount * 0.25);
}

function drawMaskedBeautyLayers(
  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  workCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  amount: number,
) {
  const workCtx = workCanvas.getContext("2d", { alpha: true });
  if (!workCtx) return;

  workCanvas.width = width;
  workCanvas.height = height;
  workCtx.clearRect(0, 0, width, height);

  workCtx.filter = `blur(${6 + amount * 4.2}px) brightness(${1.08 + amount * 0.07}) contrast(${0.90 - amount * 0.04}) saturate(${0.98 - amount * 0.02})`;
  workCtx.drawImage(sourceCanvas, 0, 0, width, height);
  workCtx.filter = "none";
  workCtx.globalCompositeOperation = "destination-in";
  workCtx.drawImage(maskCanvas, 0, 0, width, height);
  workCtx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.globalAlpha = 0.48 + amount * 0.10;
  ctx.drawImage(workCanvas, 0, 0, width, height);
  ctx.restore();

  workCtx.clearRect(0, 0, width, height);
  workCtx.filter = `blur(${9 + amount * 5.5}px) brightness(${1.10 + amount * 0.08}) contrast(${0.88 - amount * 0.04}) saturate(${0.97 - amount * 0.03})`;
  workCtx.drawImage(sourceCanvas, 0, 0, width, height);
  workCtx.filter = "none";
  workCtx.globalCompositeOperation = "destination-in";
  workCtx.drawImage(maskCanvas, 0, 0, width, height);
  workCtx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.globalAlpha = 0.16 + amount * 0.08;
  ctx.drawImage(workCanvas, 0, 0, width, height);
  ctx.restore();
}

function drawMaskedDetailRestore(
  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  workCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  amount: number,
) {
  const workCtx = workCanvas.getContext("2d", { alpha: true });
  if (!workCtx) return;

  workCanvas.width = width;
  workCanvas.height = height;
  workCtx.clearRect(0, 0, width, height);
  workCtx.filter = `contrast(${1.04 + amount * 0.03}) saturate(${1.02 + amount * 0.02})`;
  workCtx.drawImage(sourceCanvas, 0, 0, width, height);
  workCtx.filter = "none";
  workCtx.globalCompositeOperation = "destination-in";
  workCtx.drawImage(maskCanvas, 0, 0, width, height);
  workCtx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = 0.14 + amount * 0.08;
  ctx.drawImage(workCanvas, 0, 0, width, height);
  ctx.restore();
}

function drawFaceLightingBoost(
  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  amount: number,
) {
  drawMaskedFilteredOverlay(
    ctx,
    sourceCanvas,
    maskCanvas,
    width,
    height,
    `brightness(${1.30 + amount * 0.28}) saturate(${1.08 + amount * 0.08}) contrast(${1.06 + amount * 0.07})`,
    0.78 + amount * 0.14,
  );

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.16 + amount * 0.06;
  ctx.drawImage(maskCanvas, 0, 0, width, height);
  ctx.restore();
}


function drawMaskedSkinLighten(
  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  amount: number,
) {
  drawMaskedFilteredOverlay(
    ctx,
    sourceCanvas,
    maskCanvas,
    width,
    height,
    `brightness(${1.18 + amount * 0.14}) saturate(${1.02 + amount * 0.03}) contrast(${1.02 + amount * 0.04})`,
    0.34 + amount * 0.12,
  );
}


function canvasToImageData(canvas: HTMLCanvasElement, width: number, height: number) {
  const ctx = canvas.getContext("2d", { alpha: true, willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
  if (!ctx) return null;
  return ctx.getImageData(0, 0, width, height);
}

function drawBlurredSource(
  sourceCanvas: HTMLCanvasElement,
  targetCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  filter: string,
) {
  const targetCtx = targetCanvas.getContext("2d", { alpha: true });
  if (!targetCtx) return;
  targetCanvas.width = width;
  targetCanvas.height = height;
  targetCtx.clearRect(0, 0, width, height);
  targetCtx.filter = filter;
  targetCtx.drawImage(sourceCanvas, 0, 0, width, height);
  targetCtx.filter = "none";
}

function blendChannel(base: number, target: number, amount: number) {
  return base + (target - base) * amount;
}

function applyGentleMilkTone(
  image: ImageData,
  width: number,
  height: number,
  faceMask?: Uint8ClampedArray,
) {
  const data = image.data;
  const contrast = 0.90;
  const exposureLift = 0.04 * 255;
  const blackLift = 0.07 * 255;
  const saturationDelta = -0.01;
  const warmth = 0.04;
  const pink = 0.03;
  const whiteCleanBoost = 0.10;
  const neutralHighlightLift = 0.06;
  const redLuminanceDrop = -0.08;
  const redDepthBoost = 0.03;

  for (let i = 0; i < data.length; i += 4) {
    const faceWeight = faceMask ? (faceMask[i + 3] / 255) : 0;
    const toneWeight = faceMask ? 0.60 + faceWeight * 0.40 : 1;

    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    const preLuma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const lifted = blackLift * Math.pow(Math.max(0, 1 - preLuma), 1.55) * toneWeight;
    r += exposureLift * toneWeight + lifted;
    g += exposureLift * toneWeight + lifted * 0.94;
    b += exposureLift * toneWeight + lifted * 0.88;

    const pivot = 128;
    r = pivot + (r - pivot) * contrast;
    g = pivot + (g - pivot) * contrast;
    b = pivot + (b - pivot) * contrast;

    const postLuma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const highlight = clamp((postLuma - 0.72) / 0.22, 0, 1) * toneWeight;
    if (highlight > 0) {
      const roll = 0.08 * highlight;
      r = 255 - (255 - r) * (1 - roll);
      g = 255 - (255 - g) * (1 - roll);
      b = 255 - (255 - b) * (1 - roll * 0.92);
    }

    const avg = (r + g + b) / 3;
    const sat = 1 + saturationDelta * toneWeight;
    r = avg + (r - avg) * sat;
    g = avg + (g - avg) * sat;
    b = avg + (b - avg) * sat;

    const whiteWeight = getNeutralWhiteWeight(r, g, b);
    if (whiteWeight > 0) {
      const clean = whiteWeight * toneWeight;
      const neutral = (r + g + b) / 3;
      r = blendChannel(r, neutral + 255 * neutralHighlightLift, clean * 0.52);
      g = blendChannel(g, neutral + 255 * neutralHighlightLift * 0.98, clean * 0.52);
      b = blendChannel(b, neutral + 255 * neutralHighlightLift * 0.95, clean * 0.52);
      r += 255 * whiteCleanBoost * clean * 0.34;
      g += 255 * whiteCleanBoost * clean * 0.32;
      b += 255 * whiteCleanBoost * clean * 0.30;
    }

    const redWeight = getRedPinkWeight(r, g, b);
    if (redWeight > 0) {
      const deepen = redWeight * (0.55 + faceWeight * 0.45);
      r += 255 * redDepthBoost * deepen * 0.40;
      g -= 255 * Math.abs(redLuminanceDrop) * deepen * 0.12;
      b -= 255 * Math.abs(redLuminanceDrop) * deepen * 0.18;
      const redLumaDelta = 255 * redLuminanceDrop * deepen;
      r += redLumaDelta * 0.26;
      g += redLumaDelta * 0.08;
      b += redLumaDelta * 0.10;
    }

    r += 255 * warmth * (0.34 + faceWeight * 0.06) + 255 * pink * (0.24 + faceWeight * 0.08);
    g += 255 * warmth * 0.10;
    b += 255 * pink * 0.03 - 255 * warmth * 0.08;

    data[i] = Math.round(clamp(r, 0, 255));
    data[i + 1] = Math.round(clamp(g, 0, 255));
    data[i + 2] = Math.round(clamp(b, 0, 255));
  }

  return image;
}

function buildHighlightMaskData(
  sourceData: Uint8ClampedArray,
  skinMaskData: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const highlight = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < sourceData.length; i += 4) {
    const maskAlpha = skinMaskData[i + 3] / 255;
    if (maskAlpha <= 0.02) continue;

    const r = sourceData[i];
    const g = sourceData[i + 1];
    const b = sourceData[i + 2];
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const threshold = clamp((luma - 0.74) / 0.14, 0, 1) * maskAlpha;
    if (threshold <= 0) continue;

    highlight[i] = r;
    highlight[i + 1] = g;
    highlight[i + 2] = b;
    highlight[i + 3] = Math.round(255 * threshold);
  }
  return new ImageData(highlight, width, height);
}

function applyMilkInspiredSkinRefinement(
  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  workCanvas: HTMLCanvasElement,
  detailCanvas: HTMLCanvasElement,
  protectionCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  faces: FaceGeometry[],
) {
  const sourceImage = canvasToImageData(sourceCanvas, width, height);
  const maskImage = canvasToImageData(maskCanvas, width, height);
  const protectionImage = canvasToImageData(protectionCanvas, width, height);
  if (!sourceImage || !maskImage || !protectionImage) {
    ctx.drawImage(sourceCanvas, 0, 0, width, height);
    return;
  }

  const roi = getFaceProcessingRegion(faces, width, height);
  const sourceCanvasRoi = createCanvas(roi.width, roi.height);
  const sourceCanvasRoiCtx = sourceCanvasRoi.getContext("2d", { alpha: true });
  if (!sourceCanvasRoiCtx) {
    ctx.drawImage(sourceCanvas, 0, 0, width, height);
    return;
  }
  sourceCanvasRoiCtx.drawImage(sourceCanvas, roi.x, roi.y, roi.width, roi.height, 0, 0, roi.width, roi.height);

  const procWidth = Math.max(96, Math.round(roi.width * 0.64));
  const procHeight = Math.max(96, Math.round(roi.height * 0.64));
  drawBlurredSource(sourceCanvasRoi, workCanvas, procWidth, procHeight, "blur(1.9px)");
  drawBlurredSource(sourceCanvasRoi, detailCanvas, procWidth, procHeight, "blur(4.2px)");

  const roiSource = createScaledImageData(sourceCtxFromImage(sourceImage, roi.x, roi.y, roi.width, roi.height), procWidth, procHeight);
  const roiMask = createScaledImageData(sourceCtxFromImage(maskImage, roi.x, roi.y, roi.width, roi.height), procWidth, procHeight);
  const roiProtection = createScaledImageData(sourceCtxFromImage(protectionImage, roi.x, roi.y, roi.width, roi.height), procWidth, procHeight);
  const baseImage = canvasToImageData(workCanvas, procWidth, procHeight);
  const lowFreqImage = canvasToImageData(detailCanvas, procWidth, procHeight);
  if (!baseImage || !lowFreqImage) {
    ctx.drawImage(sourceCanvas, 0, 0, width, height);
    return;
  }

  const outRoi = new ImageData(new Uint8ClampedArray(roiSource.data), procWidth, procHeight);
  const src = roiSource.data;
  const base = baseImage.data;
  const low = lowFreqImage.data;
  const mask = roiMask.data;
  const protect = roiProtection.data;
  const dst = outRoi.data;

  const smoothStrength = 0.34;
  const detailPreserve = 0.76;
  const toneEvening = 0.28;

  for (let i = 0; i < dst.length; i += 4) {
    const rawMask = mask[i + 3] / 255;
    if (rawMask <= 0.001) continue;

    const protectAlpha = protect[i + 3] / 255;
    const skinMask = rawMask * (1 - protectAlpha);
    if (skinMask <= 0.001) continue;

    const srcR = src[i];
    const srcG = src[i + 1];
    const srcB = src[i + 2];
    const baseR = base[i];
    const baseG = base[i + 1];
    const baseB = base[i + 2];
    const lowR = low[i];
    const lowG = low[i + 1];
    const lowB = low[i + 2];

    const smoothedBaseR = blendChannel(baseR, lowR, toneEvening);
    const smoothedBaseG = blendChannel(baseG, lowG, toneEvening);
    const smoothedBaseB = blendChannel(baseB, lowB, toneEvening);

    const detailR = srcR - baseR;
    const detailG = srcG - baseG;
    const detailB = srcB - baseB;

    const refinedR = smoothedBaseR + detailR * detailPreserve;
    const refinedG = smoothedBaseG + detailG * detailPreserve;
    const refinedB = smoothedBaseB + detailB * detailPreserve;

    const lumaSrc = 0.299 * srcR + 0.587 * srcG + 0.114 * srcB;
    const lumaLow = 0.299 * lowR + 0.587 * lowG + 0.114 * lowB;
    const lumaMix = blendChannel(lumaSrc, lumaLow, toneEvening * 0.78);

    const finalR = blendChannel(srcR, refinedR + (lumaMix - lumaSrc) * 0.16, smoothStrength * skinMask);
    const finalG = blendChannel(srcG, refinedG + (lumaMix - lumaSrc) * 0.14, smoothStrength * skinMask);
    const finalB = blendChannel(srcB, refinedB + (lumaMix - lumaSrc) * 0.09, smoothStrength * skinMask);

    dst[i] = Math.round(clamp(finalR, 0, 255));
    dst[i + 1] = Math.round(clamp(finalG, 0, 255));
    dst[i + 2] = Math.round(clamp(finalB, 0, 255));
  }

  const roiProcessed = createCanvas(procWidth, procHeight);
  const roiProcessedCtx = roiProcessed.getContext("2d", { alpha: true });
  if (!roiProcessedCtx) {
    ctx.drawImage(sourceCanvas, 0, 0, width, height);
    return;
  }
  applyGentleMilkTone(outRoi, procWidth, procHeight, mask);
  roiProcessedCtx.putImageData(outRoi, 0, 0);

  ctx.drawImage(sourceCanvas, 0, 0, width, height);
  ctx.save();
  putScaledImageData(ctx, outRoi, roi.x, roi.y, roi.width, roi.height);
  ctx.restore();
}

function sourceCtxFromImage(image: ImageData, x: number, y: number, width: number, height: number) {
  const out = new ImageData(width, height);
  const src = image.data;
  const dst = out.data;
  for (let row = 0; row < height; row += 1) {
    const srcStart = ((y + row) * image.width + x) * 4;
    const dstStart = row * width * 4;
    dst.set(src.subarray(srcStart, srcStart + width * 4), dstStart);
  }
  return out;
}

function drawLocalizedSkinHighlights(
  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  workCanvas: HTMLCanvasElement,
  downsampleCanvas: HTMLCanvasElement,
  width: number,
  height: number,
) {
  const sourceImage = canvasToImageData(sourceCanvas, width, height);
  const maskImage = canvasToImageData(maskCanvas, width, height);
  if (!sourceImage || !maskImage) return;

  const highlightImage = buildHighlightMaskData(sourceImage.data, maskImage.data, width, height);
  const workCtx = workCanvas.getContext("2d", { alpha: true });
  const blurCtx = downsampleCanvas.getContext("2d", { alpha: true });
  if (!workCtx || !blurCtx) return;

  workCanvas.width = width;
  workCanvas.height = height;
  workCtx.clearRect(0, 0, width, height);
  workCtx.putImageData(highlightImage, 0, 0);

  const dsWidth = Math.max(64, Math.round(width * 0.42));
  const dsHeight = Math.max(64, Math.round(height * 0.42));
  downsampleCanvas.width = dsWidth;
  downsampleCanvas.height = dsHeight;
  blurCtx.clearRect(0, 0, dsWidth, dsHeight);
  blurCtx.filter = "blur(1.5px)";
  blurCtx.drawImage(workCanvas, 0, 0, dsWidth, dsHeight);
  blurCtx.filter = "none";

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.08;
  ctx.drawImage(downsampleCanvas, 0, 0, width, height);
  ctx.restore();
}

function applyMilkInspiredColorFinish(
  ctx: CanvasRenderingContext2D,
  maskCanvas: HTMLCanvasElement,
  width: number,
  height: number,
) {
  const maskImage = canvasToImageData(maskCanvas, width, height);
  if (!maskImage) return;

  const frame = ctx.getImageData(0, 0, width, height);
  const data = frame.data;
  const mask = maskImage.data;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = mask[i + 3] / 255;
    const toneWeight = 0.55 + alpha * 0.45;

    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    const whiteWeight = getNeutralWhiteWeight(r, g, b);
    if (whiteWeight > 0) {
      const clean = whiteWeight * toneWeight;
      const neutral = (r + g + b) / 3;
      r = blendChannel(r, neutral + 14, clean * 0.34);
      g = blendChannel(g, neutral + 13, clean * 0.32);
      b = blendChannel(b, neutral + 12, clean * 0.30);
    }

    const redWeight = getRedPinkWeight(r, g, b);
    if (redWeight > 0) {
      const deepen = redWeight * toneWeight;
      r = blendChannel(r, r + 5, deepen * 0.22);
      g = blendChannel(g, g - 4, deepen * 0.28);
      b = blendChannel(b, b - 5, deepen * 0.26);
    }

    const avg = (r + g + b) / 3;
    r = avg + (r - avg) * (0.992 + alpha * 0.004) + 255 * 0.04 * alpha * 0.22 + 255 * 0.03 * alpha * 0.24;
    g = avg + (g - avg) * 0.992 + 255 * 0.04 * alpha * 0.08;
    b = avg + (b - avg) * 0.992 - 255 * 0.04 * alpha * 0.05 + 255 * 0.03 * alpha * 0.03;

    data[i] = Math.round(clamp(r, 0, 255));
    data[i + 1] = Math.round(clamp(g, 0, 255));
    data[i + 2] = Math.round(clamp(b, 0, 255));
  }

  ctx.putImageData(frame, 0, 0);
}

function drawSkinSmoothing(
  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  workCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  maskBlurCanvas: HTMLCanvasElement,
  downsampleCanvas: HTMLCanvasElement,
  faces: FaceGeometry[],
  width: number,
  height: number,
  previousMaskCanvas?: HTMLCanvasElement | null,
) {
  if (!faces.length) {
    const base = canvasToImageData(sourceCanvas, width, height);
    if (base) {
      applyGentleMilkTone(base, width, height);
      ctx.putImageData(base, 0, 0);
    } else {
      ctx.drawImage(sourceCanvas, 0, 0, width, height);
    }
    return;
  }

  const protectionCanvas = cloneCanvas(maskCanvas, width, height);
  const protectionBlurCanvas = cloneCanvas(maskBlurCanvas, width, height);
  const detailCanvas = cloneCanvas(downsampleCanvas, width, height);

  buildSkinMask(maskCanvas, maskBlurCanvas, faces, width, height, previousMaskCanvas);
  refineSkinMaskByColor(maskCanvas, maskBlurCanvas, sourceCanvas, faces, width, height);
  buildDetailProtectionMask(protectionCanvas, protectionBlurCanvas, faces, width, height);

  applyMilkInspiredSkinRefinement(ctx, sourceCanvas, workCanvas, detailCanvas, protectionCanvas, maskCanvas, width, height, faces);
  drawLocalizedSkinHighlights(ctx, sourceCanvas, maskCanvas, workCanvas, downsampleCanvas, width, height);
  applyMilkInspiredColorFinish(ctx, maskCanvas, width, height);
  drawMaskedDetailRestore(ctx, sourceCanvas, workCanvas, protectionCanvas, width, height, 0.18);
}

function drawProcessedFrame(

  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  workCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  maskBlurCanvas: HTMLCanvasElement,
  downsampleCanvas: HTMLCanvasElement,
  action: VideoAction,
  faces: FaceGeometry[],
  width: number,
  height: number,
  previousSkinMaskCanvas?: HTMLCanvasElement | null,
) {
  ctx.clearRect(0, 0, width, height);
  const exposure = getExposureProfile(sourceCanvas, downsampleCanvas);

  if (action === "light") {
    ctx.save();
    ctx.filter = `brightness(${exposure.brightness.toFixed(3)}) contrast(${(exposure.contrast + 0.04).toFixed(3)}) saturate(${(exposure.saturate + 0.02).toFixed(3)})`;
    ctx.drawImage(sourceCanvas, 0, 0, width, height);
    ctx.restore();
    applyExposureFinish(ctx, width, height, exposure);
    applyGlobalPolish(ctx, width, height, 0.14);
    drawDetailBoost(ctx, sourceCanvas, width, height, 0.14);
    drawSharpenPass(ctx, sourceCanvas, width, height, 0.1);
    return;
  }

  if (action === "1tap") {
    ctx.save();
    ctx.filter = `brightness(${(exposure.brightness + 0.05).toFixed(3)}) contrast(${(exposure.contrast + 0.08).toFixed(3)}) saturate(${(exposure.saturate + 0.1).toFixed(3)})`;
    ctx.drawImage(sourceCanvas, 0, 0, width, height);
    ctx.restore();
    applyExposureFinish(ctx, width, height, exposure);
    applyPremiumNoiseControl(ctx, sourceCanvas, workCanvas, downsampleCanvas, width, height, 0.52);
    applySoftSkinFinish(ctx, sourceCanvas, workCanvas, width, height, 0.62);
    applyOneTapPolish(ctx, width, height);
    applyGlobalPolish(ctx, width, height, 0.46);
    drawDetailBoost(ctx, sourceCanvas, width, height, 0.22);
    drawSharpenPass(ctx, sourceCanvas, width, height, 0.12);
    return;
  }

  if (action === "manual") {
    ctx.drawImage(sourceCanvas, 0, 0, width, height);
    return;
  }

  if (action === "pro") {
    ctx.save();
    ctx.filter = `brightness(${(exposure.brightness + 0.01).toFixed(3)}) contrast(${(exposure.contrast + 0.1).toFixed(3)}) saturate(${(exposure.saturate + 0.05).toFixed(3)})`;
    ctx.drawImage(sourceCanvas, 0, 0, width, height);
    ctx.restore();

    applyExposureFinish(ctx, width, height, exposure);
    applyPremiumNoiseControl(ctx, sourceCanvas, workCanvas, downsampleCanvas, width, height, 0.56);
    applySoftSkinFinish(ctx, sourceCanvas, workCanvas, width, height, 0.34);
    applyLighting(ctx, width, height);
    applyProLook(ctx, width, height);
    applyGlobalPolish(ctx, width, height, 0.72);
    drawDetailBoost(ctx, sourceCanvas, width, height, 0.36);
    drawSharpenPass(ctx, sourceCanvas, width, height, 0.2);

    ctx.save();
    ctx.globalCompositeOperation = "overlay";
    const vignette = ctx.createRadialGradient(width / 2, height / 2, width * 0.16, width / 2, height / 2, width * 0.78);
    vignette.addColorStop(0, "rgba(255,255,255,0.018)");
    vignette.addColorStop(1, "rgba(0,0,0,0.08)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
    return;
  }

  ctx.drawImage(sourceCanvas, 0, 0, width, height);
}

async function fastProcessVideo(videoUrl: string, action: VideoAction, params: ManualVideoParams = {}, options: ProcessVideoOptions = {}): Promise<string> {
  if (!(window as any).MediaRecorder || !(HTMLCanvasElement.prototype as any).captureStream) {
    throw new Error("Fast video processing is not supported on this device");
  }

  const { signal } = options;
  checkAbort(signal);
  const video = await loadVideo(videoUrl, options);
  if (Number.isFinite(video.duration) && video.duration > MAX_FAST_EDIT_SECONDS) {
    throw new Error(`For fast video edits, please use a clip under ${MAX_FAST_EDIT_SECONDS} seconds.`);
  }
  const scaled = scaleDimensions(video.videoWidth, video.videoHeight, action);
  const canvas = createCanvas(scaled.width, scaled.height);
  const sourceCanvas = createCanvas(scaled.width, scaled.height);
  const workCanvas = createCanvas(scaled.width, scaled.height);
  const maskCanvas = createCanvas(scaled.width, scaled.height);
  const maskBlurCanvas = createCanvas(scaled.width, scaled.height);
  const downsampleCanvas = createCanvas(Math.max(64, Math.round(scaled.width * 0.22)), Math.max(64, Math.round(scaled.height * 0.22)));
  const ctx = canvas.getContext("2d", { alpha: false });
  const sourceCtx = sourceCanvas.getContext("2d", { alpha: false });

  if (!ctx || !sourceCtx) {
    throw new Error("Canvas video processing unavailable");
  }

  const canvasStream = canvas.captureStream(TARGET_FPS);
  let sourceStream: MediaStream | null = null;
  const mixedTracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];

  if ((video as any).captureStream) {
    sourceStream = (video as any).captureStream();
    const audioTracks = sourceStream.getAudioTracks();
    for (const track of audioTracks) mixedTracks.push(track);
  }

  const outputStream = new MediaStream(mixedTracks);
  const chunks: BlobPart[] = [];
  const recorder = createFastVideoRecorder(outputStream, action);

  let resolveStop: ((value: string) => void) | null = null;
  let rejectStop: ((reason?: unknown) => void) | null = null;

  const stopPromise = new Promise<string>((resolve, reject) => {
    resolveStop = resolve;
    rejectStop = reject;
  });

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  let stallTimer = 0;
  let absoluteTimer = 0;
  let stopped = false;
  let completed = false;
  let lastFaceDetectAt = -Infinity;
  let cachedFaces: FaceGeometry[] = [];
  let previousSkinMaskCanvas: HTMLCanvasElement | null = null;
  let lastProgressAt = performance.now();
  let lastVideoTime = -1;
  const requiresFacePass = false;

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    sourceStream?.getTracks().forEach((track) => track.stop());
    canvasStream.getTracks().forEach((track) => track.stop());
    video.pause();
    video.removeAttribute("src");
    video.load();
  };

  const finish = () => {
    if (completed) return;
    completed = true;
    if (recorder.state !== "inactive") recorder.stop();
    else cleanup();
  };

  const fail = (error: unknown) => {
    if (completed) return;
    completed = true;
    window.clearInterval(stallTimer);
    window.clearTimeout(absoluteTimer);
    cleanup();
    if (recorder.state !== "inactive") {
      try { recorder.stop(); } catch {}
    }
    rejectStop?.(error instanceof Error ? error : new Error("Video processing failed."));
  };

  recorder.onerror = (event: any) => {
    fail(event?.error || new Error("Recording failed"));
  };

  const renderFrame = async () => {
    if (video.paused || video.ended || stopped || completed) return;
    checkAbort(signal);

    drawVideoFrameToSource(sourceCtx, video, scaled.width, scaled.height, action === "manual" ? params : undefined);
    if (video.currentTime > lastVideoTime + 0.001) {
      lastVideoTime = video.currentTime;
      lastProgressAt = performance.now();
    }

    if (requiresFacePass) {
      const currentMs = video.currentTime * 1000;
      const refreshMs = FACE_REFRESH_MS;
      if (currentMs - lastFaceDetectAt >= refreshMs) {
        checkAbort(signal);
        const detected = await detectFaces(video, scaled.width, scaled.height, performance.now());
        cachedFaces = smoothFaces(cachedFaces, detected);
        lastFaceDetectAt = currentMs;
      }
    } else {
      cachedFaces = [];
    }

    drawProcessedFrame(ctx, sourceCanvas, workCanvas, maskCanvas, maskBlurCanvas, downsampleCanvas, action, cachedFaces, scaled.width, scaled.height, previousSkinMaskCanvas);
  };

  const scheduleNextFrame = () => {
    const callback = () => {
      const renderTask = requiresFacePass ? renderFrame() : Promise.resolve(renderFrame());
      renderTask
        .then(() => {
          const nearEnd = Number.isFinite(video.duration) && video.duration > 0 && video.currentTime >= Math.max(video.duration - 1 / TARGET_FPS, 0);
          if (video.ended || nearEnd) {
            finish();
            return;
          }

          if (!completed && !stopped) scheduleNextFrame();
        })
        .catch((error) => fail(error));
    };

    if ((video as any).requestVideoFrameCallback) {
      (video as any).requestVideoFrameCallback(() => callback());
    } else {
      requestAnimationFrame(() => callback());
    }
  };

  stallTimer = window.setInterval(() => {
    if (completed || stopped) return;
    if (performance.now() - lastProgressAt > VIDEO_STALL_TIMEOUT_MS) {
      fail(new Error("Video processing timed out before completion."));
    }
  }, 1000);

  absoluteTimer = window.setTimeout(() => {
    fail(new Error("Video processing took too long and was stopped."));
  }, VIDEO_ABSOLUTE_TIMEOUT_MS);

  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
    cleanup();
    window.clearInterval(stallTimer);
    window.clearTimeout(absoluteTimer);
    if (!blob.size) {
      rejectStop?.(new Error("Processed video output is empty."));
      return;
    }
    resolveStop?.(URL.createObjectURL(blob));
  };

  video.currentTime = 0;
  recorder.start(500);
  scheduleNextFrame();
  video.onended = finish;

  try {
    checkAbort(signal);
    await video.play();
  } catch (error) {
    window.clearInterval(stallTimer);
    window.clearTimeout(absoluteTimer);
    fail(error);
  }

  const outputUrl = await stopPromise;
  sourceCanvas.width = 1;
  sourceCanvas.height = 1;
  workCanvas.width = 1;
  workCanvas.height = 1;
  maskCanvas.width = 1;
  maskCanvas.height = 1;
  maskBlurCanvas.width = 1;
  maskBlurCanvas.height = 1;
  downsampleCanvas.width = 1;
  downsampleCanvas.height = 1;
  canvas.width = 1;
  canvas.height = 1;
  return outputUrl;
}


async function ensureOutputUrl(outputPath: string): Promise<string> {
  if (!outputPath) throw new Error("Invalid output");
  const response = await fetch(outputPath);
  if (!response.ok) throw new Error("Processed video output is missing.");
  const blob = await response.blob();
  if (!blob.size) throw new Error("Processed video output is empty.");
  return outputPath;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 30000, message = "Video processing timed out before completion."): Promise<T> {
  let timeoutId = 0 as any;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function buildCommand(inputName: string, outputName: string, mode: "free" | "unlock" | "pro" = "pro") {
  const crf = mode === "free" ? "32" : mode === "unlock" ? "28" : "24";
  const audioBitrate = mode === "free" ? "96k" : "128k";
  const videoBitrate = mode === "free" ? "1200k" : mode === "unlock" ? "2200k" : "3500k";
  const preset = mode === "free" ? "veryfast" : "ultrafast";
  return ["-i", inputName, "-c:v", "libx264", "-preset", preset, "-crf", crf, "-b:v", videoBitrate, "-c:a", "aac", "-b:a", audioBitrate, "-movflags", "+faststart", outputName];
}

async function getVideoDimensionsFromBlob(blob: Blob) {
  const blobUrl = URL.createObjectURL(blob);
  try {
    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const video = document.createElement("video");

      const cleanup = () => {
        video.onloadedmetadata = null;
        video.onerror = null;
        video.pause();
        video.removeAttribute("src");
        video.load();
      };

      video.preload = "metadata";
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.setAttribute("muted", "");
      video.setAttribute("playsinline", "");

      video.onloadedmetadata = () => {
        const width = Math.max(1, video.videoWidth || 1);
        const height = Math.max(1, video.videoHeight || 1);
        cleanup();
        resolve({ width, height });
      };

      video.onerror = () => {
        cleanup();
        reject(new Error("Could not read video dimensions for export."));
      };

      video.src = blobUrl;
    });
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

async function createFreeVideoWatermark(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to prepare video watermark.");

  const fontSize = Math.max(28, Math.round(Math.min(width, height) / 10));
  const spacingX = Math.max(fontSize * 2.8, width / 2.9);
  const spacingY = Math.max(fontSize * 2.4, height / 3);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `700 ${fontSize}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let x = spacingX / 2; x < canvas.width + spacingX; x += spacingX) {
    for (let y = spacingY / 2; y < canvas.height + spacingY; y += spacingY) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
      ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
      ctx.lineWidth = Math.max(2, Math.round(fontSize / 14));
      ctx.strokeText("CHROMANCY", 0, -fontSize * 0.32);
      ctx.fillText("CHROMANCY", 0, -fontSize * 0.32);
      ctx.strokeText("FREE EXPORT", 0, fontSize * 0.42);
      ctx.fillText("FREE EXPORT", 0, fontSize * 0.42);
      ctx.restore();
    }
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Failed to encode video watermark.");
  return blob;
}

function buildWatermarkedCommand(inputName: string, overlayName: string, outputName: string) {
  const base = buildCommand(inputName, outputName, "free");
  return [
    "-i",
    inputName,
    "-i",
    overlayName,
    "-filter_complex",
    "[0:v][1:v]overlay=0:0:format=auto[v]",
    "-map",
    "[v]",
    "-map",
    "0:a?",
    ...base.slice(2),
  ];
}

async function convertBlobToMp4(blob: Blob, mode: "free" | "unlock" | "pro" = "pro"): Promise<Blob> {
  if (blob.type.includes("mp4") && mode !== "free") {
    return blob;
  }

  const ffmpeg = await getFFmpeg();
  const inputExtension = blob.type.includes("webm") ? "webm" : blob.type.includes("ogg") ? "ogv" : "video";
  const inputName = `export_input_${Date.now()}.${inputExtension}`;
  const outputName = `export_output_${Date.now()}.mp4`;
  const overlayName = `export_overlay_${Date.now()}.png`;

  try {
    await ffmpeg.writeFile(inputName, new Uint8Array(await blob.arrayBuffer()));
    if (mode === "free") {
      const { width, height } = await getVideoDimensionsFromBlob(blob);
      const overlay = await createFreeVideoWatermark(width, height);
      await ffmpeg.writeFile(overlayName, new Uint8Array(await overlay.arrayBuffer()));
    }
    const command = mode === "free"
      ? buildWatermarkedCommand(inputName, overlayName, outputName)
      : buildCommand(inputName, outputName, mode);
    const exitCode = await withTimeout(ffmpeg.exec(command), 90000, "Video export conversion timed out.");
    if (exitCode !== 0) {
      throw new Error(`FFmpeg export conversion failed with code ${exitCode}`);
    }
    const data = await ffmpeg.readFile(outputName);
    return new Blob([(data as any).buffer], { type: "video/mp4" });
  } finally {
    try { await ffmpeg.deleteFile(inputName); } catch {}
    try { await ffmpeg.deleteFile(overlayName); } catch {}
    try { await ffmpeg.deleteFile(outputName); } catch {}
  }
}

async function validatePlayableVideoUrl(videoUrl: string, timeoutMs = 12000): Promise<string> {
  if (!videoUrl) throw new Error("Invalid output");

  const response = await fetch(videoUrl);
  if (!response.ok) throw new Error("Processed video output is missing.");

  const blob = await response.blob();
  if (!blob.size) throw new Error("Processed video output is empty.");

  const playableUrl = URL.createObjectURL(blob);

  try {
    await withTimeout(new Promise<void>((resolve, reject) => {
      const probe = document.createElement("video");
      let settled = false;

      const cleanup = () => {
        probe.onloadedmetadata = null;
        probe.oncanplay = null;
        probe.onerror = null;
        probe.pause();
        probe.removeAttribute("src");
        probe.load();
      };

      const succeed = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const fail = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("Processed video output is not playable."));
      };

      probe.preload = "metadata";
      probe.muted = true;
      probe.defaultMuted = true;
      probe.playsInline = true;
      probe.setAttribute("muted", "");
      probe.setAttribute("playsinline", "");
      probe.onloadedmetadata = () => {
        if (probe.videoWidth > 0 && probe.videoHeight > 0) succeed();
      };
      probe.oncanplay = () => {
        if (probe.videoWidth > 0 && probe.videoHeight > 0) succeed();
      };
      probe.onerror = fail;
      probe.src = playableUrl;
    }), timeoutMs, "Processed video output is not playable.");

    return playableUrl;
  } catch (error) {
    URL.revokeObjectURL(playableUrl);
    throw error;
  }
}

async function exportFreeWatermarkedVideo(videoUrl: string): Promise<Blob> {
  if (!(window as any).MediaRecorder || !(HTMLCanvasElement.prototype as any).captureStream) {
    throw new Error("Free video export is not supported on this device.");
  }

  const video = await loadVideo(videoUrl);
  const canvas = createCanvas(Math.max(1, video.videoWidth), Math.max(1, video.videoHeight));
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    throw new Error("Video export canvas is not available.");
  }

  const canvasStream = canvas.captureStream(Math.max(12, TARGET_FPS));
  let sourceStream: MediaStream | null = null;
  const mixedTracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];

  if ((video as any).captureStream) {
    sourceStream = (video as any).captureStream();
    sourceStream.getAudioTracks().forEach((track) => mixedTracks.push(track));
  }

  const outputStream = new MediaStream(mixedTracks);
  const recorder = createFastVideoRecorder(outputStream, "manual");
  const chunks: BlobPart[] = [];

  let stopped = false;
  let completed = false;
  let resolveStop: ((value: Blob) => void) | null = null;
  let rejectStop: ((reason?: unknown) => void) | null = null;
  let stallTimer = 0;
  let absoluteTimer = 0;
  let lastProgressAt = performance.now();
  let lastVideoTime = -1;

  const stopPromise = new Promise<Blob>((resolve, reject) => {
    resolveStop = resolve;
    rejectStop = reject;
  });

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    sourceStream?.getTracks().forEach((track) => track.stop());
    canvasStream.getTracks().forEach((track) => track.stop());
    video.pause();
    video.removeAttribute("src");
    video.load();
  };

  const finish = () => {
    if (completed) return;
    completed = true;
    if (recorder.state !== "inactive") recorder.stop();
    else cleanup();
  };

  const fail = (error: unknown) => {
    if (completed) return;
    completed = true;
    window.clearInterval(stallTimer);
    window.clearTimeout(absoluteTimer);
    cleanup();
    if (recorder.state !== "inactive") {
      try { recorder.stop(); } catch {}
    }
    rejectStop?.(error instanceof Error ? error : new Error("Free video export failed."));
  };

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  recorder.onerror = (event: any) => {
    fail(event?.error || new Error("Free video export recording failed."));
  };

  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
    cleanup();
    window.clearInterval(stallTimer);
    window.clearTimeout(absoluteTimer);
    if (!blob.size) {
      rejectStop?.(new Error("Free video export produced an empty file."));
      return;
    }
    resolveStop?.(blob);
  };

  const renderFrame = () => {
    if (video.paused || video.ended || stopped || completed) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    drawFreeExportWatermark(ctx, canvas.width, canvas.height);

    if (video.currentTime > lastVideoTime + 0.001) {
      lastVideoTime = video.currentTime;
      lastProgressAt = performance.now();
    }
  };

  const scheduleNextFrame = () => {
    const callback = () => {
      try {
        renderFrame();
        const nearEnd = Number.isFinite(video.duration) && video.duration > 0 && video.currentTime >= Math.max(video.duration - 1 / Math.max(12, TARGET_FPS), 0);
        if (video.ended || nearEnd) {
          finish();
          return;
        }
        if (!completed && !stopped) scheduleNextFrame();
      } catch (error) {
        fail(error);
      }
    };

    if ((video as any).requestVideoFrameCallback) {
      (video as any).requestVideoFrameCallback(() => callback());
    } else {
      requestAnimationFrame(() => callback());
    }
  };

  stallTimer = window.setInterval(() => {
    if (completed || stopped) return;
    if (performance.now() - lastProgressAt > VIDEO_STALL_TIMEOUT_MS) {
      fail(new Error("Free video export timed out before completion."));
    }
  }, 1000);

  absoluteTimer = window.setTimeout(() => {
    fail(new Error("Free video export took too long and was stopped."));
  }, Math.max(VIDEO_ABSOLUTE_TIMEOUT_MS, 120000));

  video.currentTime = 0;
  recorder.start(500);
  scheduleNextFrame();
  video.onended = finish;

  try {
    await video.play();
  } catch (error) {
    fail(error);
  }

  return await stopPromise;
}

export async function processVideo(videoUrl: string, action: string, params: any = {}, options: ProcessVideoOptions = {}): Promise<string> {
  if (action === "light" || action === "1tap" || action === "pro" || action === "manual") {
    const outputPath = await fastProcessVideo(videoUrl, action as VideoAction, params, options);
    return await validatePlayableVideoUrl(outputPath);
  }

  checkAbort(options.signal);
  const ffmpeg = await getFFmpeg();
  const { fetchFile } = await loadModules();
  const inputName = `input_${Date.now()}.mp4`;
  const outputName = `output_${Date.now()}.mp4`;

  try {
    checkAbort(options.signal);
    await ffmpeg.writeFile(inputName, await fetchFile(videoUrl));
    const exitCode = await withTimeout(ffmpeg.exec(buildCommand(inputName, outputName)), 30000, "Video processing timed out before completion.");
    checkAbort(options.signal);
    if (exitCode !== 0) throw new Error(`FFmpeg execution failed with code ${exitCode}`);
    const data = await ffmpeg.readFile(outputName);
    const outputPath = URL.createObjectURL(new Blob([(data as any).buffer], { type: "video/mp4" }));
    return await validatePlayableVideoUrl(outputPath);
  } finally {
    try { await ffmpeg.deleteFile(inputName); } catch {}
    try { await ffmpeg.deleteFile(outputName); } catch {}
  }
}

export async function exportVideo(videoUrl: string, mode: "free" | "unlock" | "pro") {
  const response = await fetch(videoUrl);
  if (!response.ok) throw new Error(`Video export failed (${response.status})`);
  const blob = await response.blob();
  if (mode === "free") {
    try {
      return await exportFreeWatermarkedVideo(videoUrl);
    } catch (error) {
      console.warn("Recorder watermark export failed; falling back to FFmpeg watermark export.", error);
    }
  }
  if (blob.type.includes("mp4") && mode !== "free") return blob;

  try {
    return await convertBlobToMp4(blob, mode);
  } catch (error) {
    console.warn("MP4 conversion failed; exporting the playable recorder output instead.", error);
    if (mode === "free") {
      throw new Error("Free video export could not apply the required watermark. Please try again.");
    }
    return blob;
  }
}
