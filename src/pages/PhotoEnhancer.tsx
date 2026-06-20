import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Upload,
  Sparkles,
  Maximize,
  Download,
  Undo,
  Redo,
  History,
  Layers,
  Zap,
  Sun,
  Trash2,
  Droplets,
  User,
  Expand,
  Palette,
  Focus,
  RotateCcw,
  SlidersHorizontal,
  Scissors,
  ChevronUp,
  ChevronDown,
  ChevronsDown,
} from "lucide-react";
import { cn } from "../lib/utils";
import { UserTier } from "../types";
import { cancelActiveAiRequests, enhancePhoto, posePerfect, isUnsuitableInputError, getAiRequestErrorMessage, isAiGenerationCancelledError, requestAiSpendConfirmation } from "../lib/gemini";
import { toast } from "sonner";
import { useDropzone } from "react-dropzone";
import { ensureApiKey, isLoginRequiredError } from "../lib/auth-utils";
import { auth } from "../lib/firebase";
import { usePhotoStack } from "../lib/usePhotoStack";
import { processPhotoLocally, resolveProcessedPhotoForExport } from "../lib/localMedia";
import { saveBlobToDevice, convertDataUrlToBlob, sanitizeExtension, extensionFromMimeType } from "../lib/exportMedia";
import { HistoryDrawer } from "../components/HistoryDrawer";
import { PreviewRenderer } from "../components/PreviewRenderer";
import { getToolConfig, UI_TOOL_TO_INTERNAL_ID } from "../lib/toolConfig";
import { getExportMode } from "../lib/exportRules";

interface PhotoEnhancerProps {
  tier: UserTier;
  onNavigate?: (tab: string) => void;
}

const PHOTO_AI_FACE_PRESERVATION_RULE = "ABSOLUTE IDENTITY LOCK — HIGHEST PRIORITY, OVERRIDES EVERYTHING ELSE: The person in the output MUST be the exact same individual as in the input, instantly recognisable as the same person by someone who knows them. Preserve the face 100%: facial identity, bone structure, face shape, eye shape and spacing, eyebrows, nose, lips, mouth, jawline, chin, cheeks, skin tone, skin texture, freckles and marks, hairline and hair, and the natural expression. Do NOT beautify, slim, reshape, smooth into a different face, regenerate, face-swap, age, de-age, change ethnicity, or make the person resemble anyone else. If the requested effect risks altering the face, keep the face pixel-faithful and apply the effect only to the rest of the image. Apply ONLY the specific requested tool effect and change nothing about the person's identity. FRAME & COMPOSITION LOCK: keep the full original composition and framing intact — do not crop, zoom in, rotate, stretch, cut off, or reframe the subject or scene, and do not add borders, captions, text, or watermarks. PREMIUM QUALITY: deliver a clean, photorealistic, high-resolution, professional result with natural skin texture and lighting, and free of artifacts, halos, oversharpening, warping, smudging, or plastic skin.";
const PHOTO_TAB_TITLE = "Photo Enhancements";
const PHOTO_TAB_DESCRIPTION = "Fix, enhance, and transform photos in seconds.";

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

const FREE_TOOLS = [
  { id: "manual", icon: SlidersHorizontal, label: "Manual Edit", instruction: "Crop, rotate, adjust, blur, and filter manually.", description: "Edit manually" },
  { id: "1tap", icon: Zap, label: "1-Tap Fix", instruction: "Manual one-tap polish with lighting, skin tone lift, and crisp detail.", description: "Instant enhance" },
  { id: "light", icon: Sun, label: "Fix Lighting", instruction: "Manual lighting correction that recovers overly bright highlights, lifts underexposed shadows, balances exposure, and keeps skin tones natural without flattening the image.", description: "Adjust lighting" },
  { id: "sharp", icon: Maximize, label: "Sharpen", instruction: "Manual sharpness boost for cleaner detail.", description: "Enhance details" },
  { id: "hd", icon: Sparkles, label: "HD Upgrade", instruction: "AI pro-camera HD upgrade that keeps the exact same photo and only improves clarity, detail, and professional camera quality.", description: "Pro-camera HD" },
];

const PREMIUM_TOOLS = [
  { id: "outpaint", icon: Expand, label: "Extend Photo", instruction: "Extend the photo background naturally while keeping the original subject intact and preserving the exact same face and facial identity.", description: "Expand background" },
  { id: "change_bg", icon: Layers, label: "Change Background", instruction: "Replace the background according to the user request while preserving the subject exactly, especially the face and facial identity.", description: "Replace background" },
  { id: "vibe", icon: Palette, label: "Change Vibe", instruction: "Apply the selected vibe much more strongly while preserving the exact same face, facial identity, body structure, and overall realism. Improve ambience, color direction, atmosphere, and mood without distorting the subject.", description: "Add desired ambience" },
  { id: "pose", icon: User, label: "Pose Perfect", instruction: "Adjust the pose exactly as the user requests while preserving identity and natural proportions.", isPose: true, description: "Adjust pose" },
  { id: "skin", icon: User, label: "Smooth Skin", instruction: "Clear skin, smooth texture, and remove blemishes while keeping realistic skin texture and natural identity. Preserve the subject's face and facial identity exactly.", description: "Soften skin" },
  { id: "remove", icon: Trash2, label: "Remove Clutter", instruction: "Detect clutter automatically, remove distractions more accurately, protect the main subject and important objects, produce cleaner natural fills, and avoid artifacts or accidental removals. Do not require a brush or manual mask. Preserve the subject's face and facial identity exactly.", description: "Clear distractions" },
  { id: "blur", icon: Droplets, label: "Blur Background", instruction: "Blur the existing background much more strongly than the current version, with a premium depth-of-field look roughly 5x stronger while keeping the subject natural and unchanged. Preserve the subject's face and facial identity exactly. Do not blur the face or body.", description: "Professional blur" },
  { id: "headshot", icon: User, label: "Pro Headshot", instruction: "Generate a professional headshot from the uploaded photo with realistic skin texture, a detailed face, sharp focus, natural proportions, and polished professional lighting while preserving the exact same face and facial identity.", description: "Professional portrait" },
  { id: "face", icon: Focus, label: "Face Focus Enhancer", instruction: "Make the face focus enhancement stronger and cleaner by targeting the face only, boosting facial clarity, local contrast, micro-sharpness, eye detail, and natural focus without changing identity, facial structure, skin tone, or adding makeup or beauty effects. Keep skin realistic, preserve the full frame exactly, and do not strongly affect the background.", description: "Enhance face" },
];

const MANUAL_FILTERS: { id: ManualFilterId; label: string; values: { brightness?: number; contrast?: number; saturation?: number; blur?: number; grayscale?: number; sepia?: number; hueRotate?: number } }[] = [
  { id: "none", label: "None", values: {} },
  { id: "natural", label: "Natural", values: { brightness: 102, contrast: 102, saturation: 104 } },
  { id: "milk", label: "Milk", values: { brightness: 126, contrast: 88, saturation: 80, blur: 0.45 } },
  { id: "blackwhite", label: "Black & White", values: { grayscale: 100, contrast: 108 } },
  { id: "warm", label: "Warm", values: { brightness: 104, contrast: 102, saturation: 112, sepia: 10 } },
  { id: "cool", label: "Cool", values: { brightness: 101, contrast: 104, saturation: 105, hueRotate: 8 } },
  { id: "cinema", label: "Cinema", values: { brightness: 98, contrast: 116, saturation: 110, sepia: 12 } },
  { id: "pop", label: "Pop", values: { brightness: 104, contrast: 120, saturation: 126 } },
  { id: "faded", label: "Faded", values: { brightness: 106, contrast: 82, saturation: 92 } },
  { id: "mono", label: "Mono", values: { grayscale: 55, contrast: 110, saturation: 80 } },
  { id: "softglow", label: "Soft Glow", values: { brightness: 106, contrast: 95, saturation: 103, blur: 0.3 } },
];

function createDefaultManualEditState(): ManualEditState {
  return {
    cropX: 0,
    cropY: 0,
    cropWidth: 100,
    cropHeight: 100,
    rotation: 0,
    brightness: 100,
    contrast: 100,
    saturation: 100,
    blur: 0,
    filter: "none",
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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

async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
}

async function loadImageElement(source: string): Promise<HTMLImageElement> {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.decoding = "async";
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("Failed to decode image."));
    element.src = source;
  });
}

function getPreferredUploadMimeType(file: File) {
  const mimeType = (file.type || "").toLowerCase();
  if (mimeType === "image/png" || mimeType === "image/webp") {
    return mimeType;
  }

  if (file.name.toLowerCase().includes("screenshot")) {
    return "image/png";
  }

  return "image/jpeg";
}

async function normaliseUploadedPhoto(file: File): Promise<string> {
  const targetMimeType = getPreferredUploadMimeType(file);
  const quality = targetMimeType === "image/jpeg" ? 0.96 : 0.98;
  const maxDimension = 4096;

  const renderToCanvas = (width: number, height: number, draw: (ctx: CanvasRenderingContext2D, targetWidth: number, targetHeight: number) => void) => {
    const scale = Math.min(1, maxDimension / Math.max(width, height, 1));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to prepare image canvas.");
    }

    draw(ctx, targetWidth, targetHeight);
    return canvas.toDataURL(targetMimeType, quality);
  };

  if (typeof createImageBitmap === "function") {
    try {
      // iOS WKWebView ignores EXIF orientation in createImageBitmap by default,
      // which made portrait photos load rotated/cropped. "from-image" bakes the
      // EXIF orientation into the bitmap so iOS matches Android behaviour.
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch {
        bitmap = await createImageBitmap(file);
      }
      try {
        return renderToCanvas(bitmap.width, bitmap.height, (ctx, targetWidth, targetHeight) => {
          ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
        });
      } finally {
        bitmap.close();
      }
    } catch {
      // Fall back to standard image decode.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageElement(objectUrl);
    return renderToCanvas(image.naturalWidth, image.naturalHeight, (ctx, targetWidth, targetHeight) => {
      ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
    });
  } catch {
    return await readFileAsDataUrl(file);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function normaliseManualEditState(state: ManualEditState): ManualEditState {
  const cropX = clamp(state.cropX, 0, 95);
  const cropY = clamp(state.cropY, 0, 95);
  const cropWidth = clamp(state.cropWidth, 5, 100 - cropX);
  const cropHeight = clamp(state.cropHeight, 5, 100 - cropY);

  return {
    ...state,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    brightness: clamp(state.brightness, 0, 200),
    contrast: clamp(state.contrast, 0, 200),
    saturation: clamp(state.saturation, 0, 200),
    blur: clamp(state.blur, 0, 10),
  };
}

async function renderManualEdit(source: string, state: ManualEditState): Promise<string> {
  const safeState = normaliseManualEditState(state);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("Failed to load image"));
    element.src = source;
  });

  const cropX = Math.round((safeState.cropX / 100) * img.naturalWidth);
  const cropY = Math.round((safeState.cropY / 100) * img.naturalHeight);
  const cropWidth = Math.max(1, Math.round((safeState.cropWidth / 100) * img.naturalWidth));
  const cropHeight = Math.max(1, Math.round((safeState.cropHeight / 100) * img.naturalHeight));
  const quarterTurns = ((((safeState.rotation % 360) + 360) % 360) / 90) % 4;
  const swapSides = quarterTurns % 2 === 1;

  const canvas = document.createElement("canvas");
  canvas.width = swapSides ? cropHeight : cropWidth;
  canvas.height = swapSides ? cropWidth : cropHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to create edit canvas");
  }

  const preset = MANUAL_FILTERS.find((filter) => filter.id === safeState.filter)?.values || {};
  const brightness = ((safeState.brightness * (preset.brightness ?? 100)) / 100).toFixed(2);
  const contrast = ((safeState.contrast * (preset.contrast ?? 100)) / 100).toFixed(2);
  const saturation = ((safeState.saturation * (preset.saturation ?? 100)) / 100).toFixed(2);
  const blur = (safeState.blur + (preset.blur ?? 0)).toFixed(2);
  const grayscale = (preset.grayscale ?? 0).toFixed(2);
  const sepia = (preset.sepia ?? 0).toFixed(2);
  const hueRotate = (preset.hueRotate ?? 0).toFixed(2);

  ctx.save();
  ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) blur(${blur}px) grayscale(${grayscale}%) sepia(${sepia}%) hue-rotate(${hueRotate}deg)`;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((quarterTurns * Math.PI) / 2);
  ctx.drawImage(img, cropX, cropY, cropWidth, cropHeight, -cropWidth / 2, -cropHeight / 2, cropWidth, cropHeight);
  ctx.restore();

  return canvas.toDataURL("image/jpeg", 0.95);
}

async function prepareOutpaintSource(source: string): Promise<string> {
  const image = await loadImageElement(source);
  const expandRatio = 0.28;
  const marginX = Math.max(48, Math.round(image.naturalWidth * expandRatio));
  const marginY = Math.max(48, Math.round(image.naturalHeight * expandRatio));
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth + marginX * 2;
  canvas.height = image.naturalHeight + marginY * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) return source;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, marginX, marginY);
  return canvas.toDataURL("image/png", 0.98);
}



async function renderLocalPhotoTool(source: string, toolId: "1tap" | "light" | "sharp" | "hd"): Promise<string> {
  return await processPhotoLocally(source, toolId);
}

export function PhotoEnhancer({ tier, onNavigate }: PhotoEnhancerProps) {
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const {
    currentImage,
    pushImage,
    undo,
    redo,
    reset,
    selectHistory,
    canUndo,
    canRedo,
    history,
    historyEntries,
  } = usePhotoStack(null);

  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [usedPremium, setUsedPremium] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [posePrompt, setPosePrompt] = useState("");
  const [bgPrompt, setBgPrompt] = useState("");
  const [vibePrompt, setVibePrompt] = useState("");
  const [manualEdit, setManualEdit] = useState<ManualEditState>(createDefaultManualEditState());
  const [manualHistory, setManualHistory] = useState<ManualEditState[]>([createDefaultManualEditState()]);
  const [manualHistoryIndex, setManualHistoryIndex] = useState(0);
  const [showManualTray, setShowManualTray] = useState(false);
  const [sourceExtension, setSourceExtension] = useState<string>("jpg");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewViewportRef = useRef<HTMLDivElement>(null);
  const previewStageRef = useRef<HTMLDivElement>(null);
  const manualTrayScrollRef = useRef<HTMLDivElement>(null);
  const bottomToolBarRef = useRef<HTMLDivElement>(null);
  const [showScrollHintOverlay, setShowScrollHintOverlay] = useState(false);
  const [scrollHintBottom, setScrollHintBottom] = useState(18);
  const [manualTrayBottomOffset, setManualTrayBottomOffset] = useState(188);
  const mediaSessionRef = useRef(0);
  const processingRunRef = useRef(0);
  const photoBlobUrlsRef = useRef<string[]>([]);

  const releasePhotoMediaAssets = useCallback(() => {
    const urls = new Set<string>(photoBlobUrlsRef.current);
    photoBlobUrlsRef.current = [];
    urls.forEach((url: string) => {
      try { URL.revokeObjectURL(url); } catch {}
    });
  }, []);

  useEffect(() => {
    const urls = new Set<string>();
    const collect = (value: string | null | undefined) => {
      if (value && value.startsWith("blob:")) urls.add(value);
    };

    collect(originalImage);
    collect(currentImage);
    historyEntries.forEach((entry) => {
      collect(entry.uri);
      collect(entry.thumbnailUri || undefined);
    });

    photoBlobUrlsRef.current = Array.from(urls);
  }, [currentImage, historyEntries, originalImage]);

  const resetPhotoEditorUi = useCallback(() => {
    reset(null);
    setOriginalImage(null);
    setSelectedTool(null);
    setShowHistory(false);
    setBgPrompt("");
    setPosePrompt("");
    setVibePrompt("");
    const resetState = createDefaultManualEditState();
    setManualEdit(resetState);
    setManualHistory([resetState]);
    setManualHistoryIndex(0);
    setShowManualTray(false);
  }, [reset]);

  const clearPhotoSession = useCallback(() => {
    releasePhotoMediaAssets();
    resetPhotoEditorUi();
    setUsedPremium(false);
  }, [releasePhotoMediaAssets, resetPhotoEditorUi]);

  const resetManualToolState = useCallback((options?: { closeTray?: boolean }) => {
    const resetState = createDefaultManualEditState();
    setManualEdit(resetState);
    setManualHistory([resetState]);
    setManualHistoryIndex(0);
    if (options?.closeTray) {
      setShowManualTray(false);
    }
  }, []);

  // Fully close the manual editor tray (back to the tool grid — no floating bar left behind).
  const closeManualTray = useCallback(() => {
    setShowManualTray(false);
    setSelectedTool(null);
    resetManualToolState();
  }, [resetManualToolState]);

  const onDrop = async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    clearPhotoSession();
    mediaSessionRef.current += 1;
    processingRunRef.current += 1;
    setIsProcessing(false);
    setSourceExtension(sanitizeExtension(file.name.split(".").pop()) || extensionFromMimeType(getPreferredUploadMimeType(file)) || extensionFromMimeType(file.type) || "jpg");

    try {
      const dataUrl = await normaliseUploadedPhoto(file);
      setOriginalImage(dataUrl);
      reset(dataUrl, { type: "image", thumbnailUri: dataUrl });
      setSelectedTool(null);
      setShowHistory(false);
      setManualEdit(createDefaultManualEditState());
      setManualHistory([createDefaultManualEditState()]);
      setManualHistoryIndex(0);
      setShowManualTray(false);
    } catch (error) {
      console.error(error);
      toast.error("Could not load this photo.");
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".jpeg", ".jpg", ".png", ".webp", ".bmp", ".avif", ".heic", ".heif"] },
    multiple: false,
  } as any);

  useEffect(() => () => {
    cancelActiveAiRequests();
    releasePhotoMediaAssets();
  }, [releasePhotoMediaAssets]);

  useEffect(() => {
    const toolbar = bottomToolBarRef.current;
    if (!toolbar) return;

    const updateOffset = () => {
      const toolbarRect = toolbar.getBoundingClientRect();
      const visualViewport = window.visualViewport;
      const viewportBottom = visualViewport ? visualViewport.offsetTop + visualViewport.height : window.innerHeight;
      const distanceFromScreenBottomToToolbarTop = Math.max(0, viewportBottom - toolbarRect.top);

      // Keep the floating tray above the page toolbar and the app-level bottom nav.
      setManualTrayBottomOffset(Math.ceil(distanceFromScreenBottomToToolbarTop + 12));
    };

    updateOffset();
    window.addEventListener("resize", updateOffset, { passive: true });
    window.visualViewport?.addEventListener("resize", updateOffset, { passive: true });
    window.visualViewport?.addEventListener("scroll", updateOffset, { passive: true });

    if (typeof ResizeObserver === "undefined") {
      return () => {
        window.removeEventListener("resize", updateOffset);
        window.visualViewport?.removeEventListener("resize", updateOffset);
        window.visualViewport?.removeEventListener("scroll", updateOffset);
      };
    }

    const observer = new ResizeObserver(updateOffset);
    observer.observe(toolbar);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOffset);
      window.visualViewport?.removeEventListener("resize", updateOffset);
      window.visualViewport?.removeEventListener("scroll", updateOffset);
    };
  }, []);


  const getUnsuitableInputMessage = (toolId: string) => {
    switch (toolId) {
      case "outpaint":
        return "This photo is not suited for Extend Photo. Please upload a different photo with a clearer scene and edges.";
      case "remove":
        return "This image is not suited for Remove Clutter. Please upload a different image with clearer clutter separation.";
      case "face":
        return "This photo is not suited for Face Focus. Please upload a different photo with a clearer visible face.";
      default:
        return "This picture is not suited for this tool. Please upload a different one.";
    }
  };

  const handleEnhance = async (toolId?: string, sourceOverride?: string) => {
    const id = toolId || selectedTool;
    const sourceImage = sourceOverride || currentImage;
    if (!sourceImage || !id) return;
    const mediaSessionId = mediaSessionRef.current;
    let runId = 0;
    const localOnlyTools = new Set(["1tap", "light", "sharp"]);
    const aiMeta = { toolId: UI_TOOL_TO_INTERNAL_ID[id], tier, sessionKey: String(mediaSessionId) };

    if (id === "manual") {
      return;
    }

    const isPremium = PREMIUM_TOOLS.some((t) => t.id === id);
    void isPremium;

    if (!localOnlyTools.has(id)) {
      if (!auth.currentUser) {
        toast.error("Please log in before using AI tools.");
        onNavigate?.("auth");
        return;
      }
      if (id === "change_bg" && !bgPrompt) {
        toast.error("Please enter a background description");
        return;
      }
      if (id === "pose" && !posePrompt) {
        toast.error("Please enter a pose instruction");
        return;
      }
      if (id === "vibe" && !vibePrompt) {
        toast.error("Please choose a vibe");
        return;
      }
      try {
        await requestAiSpendConfirmation(aiMeta);
      } catch (error) {
        if (isAiGenerationCancelledError(error)) {
          return;
        }
        toast.error(getAiRequestErrorMessage(error, "Could not confirm AI usage. Please try again."));
        return;
      }
    }

    runId = ++processingRunRef.current;
    setIsProcessing(true);
    try {
      if (!localOnlyTools.has(id)) {
        await ensureApiKey();
      }

      const tool = [...FREE_TOOLS, ...PREMIUM_TOOLS].find((t) => t.id === id);
      let result: string;

      if (id === "outpaint") {
        const outpaintSource = await prepareOutpaintSource(sourceImage);
        result = await enhancePhoto(
          outpaintSource,
          `Extend Photo: The uploaded image has the original photo centered on a transparent expanded canvas. Fill ONLY the transparent empty canvas around the original photo to extend the scene naturally. Preserve the centered original photo, subject, face, body, clothing, product details, lighting, and composition exactly. Do not replace the background, do not crop back to the original size, do not zoom, do not change the subject, and do not add text or watermarks. Extend the surrounding environment seamlessly with matching perspective, colors, textures, depth, and realistic detail. ${PHOTO_AI_FACE_PRESERVATION_RULE}`,
          undefined,
          aiMeta,
        );
      } else if (id === "remove") {
        result = await enhancePhoto(sourceImage, `${tool?.instruction || ""} ${PHOTO_AI_FACE_PRESERVATION_RULE} Keep realistic skin texture, detailed faces, sharp focus, natural proportions, and a premium high-quality finish.`, undefined, aiMeta);
      } else if (id === "change_bg") {
        result = await enhancePhoto(sourceImage, `Change Background: Replace only the background with this user request: ${bgPrompt}. Keep the subject unchanged. Preserve face, body, hair, clothing, accessories, product details, and foreground edges exactly. ${PHOTO_AI_FACE_PRESERVATION_RULE} Blend edges perfectly with realistic lighting, perspective, colors, shadows, and depth. Do not extend the canvas, do not crop, and do not alter the subject.`, undefined, aiMeta);
      } else if (id === "pose") {
        result = await posePerfect(sourceImage, `${posePrompt}. ${PHOTO_AI_FACE_PRESERVATION_RULE} Keep realistic skin texture, detailed face, sharp focus, 4k feel, and natural proportions.`, aiMeta);
      } else if (id === "vibe") {
        result = await enhancePhoto(sourceImage, `Change Vibe: ${vibePrompt}. ${PHOTO_AI_FACE_PRESERVATION_RULE} Keep the person or main subject realistic with natural proportions, realistic skin texture, a detailed face, sharp focus, and premium high-quality 4k feel.`, undefined, aiMeta);
      } else if (id === "hd") {
        result = await enhancePhoto(
          sourceImage,
          `HD Upgrade: Upgrade this exact photo to a professional-camera high-definition result. Preserve the exact same face, subject identity, pose, body shape, clothing, objects, text, logos, background, framing, composition, colors, and scene layout exactly as they are. Do not add, remove, replace, move, reshape, restyle, beautify, regenerate, or alter any face, person, object, product, or text. Do not change the expression, hair, skin tone, background design, or proportions. Only improve real photographic quality by enhancing sharpness, micro-detail, lens clarity, natural texture, realistic dynamic range, clean noise control, crisp focus, and premium camera-quality definition. ${PHOTO_AI_FACE_PRESERVATION_RULE}`,
          undefined,
          { imageSize: "2K", ...aiMeta },
        );
      } else if (["1tap", "light", "sharp"].includes(id)) {
        result = await renderLocalPhotoTool(sourceImage, id);
      } else {
        result = await enhancePhoto(sourceImage, `${tool?.instruction || ""} ${PHOTO_AI_FACE_PRESERVATION_RULE} Output should be high quality, realistic skin texture, detailed face, sharp focus, 4k feel, and natural proportions.`, undefined, aiMeta);
      }

      if (mediaSessionRef.current !== mediaSessionId || processingRunRef.current !== runId) return;
      const internalToolId = aiMeta.toolId;
      const paidAiTool = internalToolId ? getToolConfig(internalToolId) : null;
      if (paidAiTool?.isAi && paidAiTool.pricingTier !== "free") {
        setUsedPremium(true);
      }
      pushImage(result, { type: result.startsWith("blob:") ? "video" : "image", thumbnailUri: result.startsWith("blob:") ? null : result });
      toast.success("Enhancement complete");
    } catch (error: any) {
      if (isAiGenerationCancelledError(error)) {
        return;
      }
      if (isLoginRequiredError(error)) {
        toast.error("Please log in before using AI tools.");
        onNavigate?.("auth");
      } else if (isUnsuitableInputError(error)) {
        toast.error(getUnsuitableInputMessage(id));
        console.error(error);
      } else {
        toast.error(getAiRequestErrorMessage(error, "Processing failed. Please try again."));
        console.error(error);
      }
    } finally {
      if (mediaSessionRef.current === mediaSessionId && processingRunRef.current === runId) setIsProcessing(false);
      if (id === "remove" && maskCanvasRef.current) {
        const ctx = maskCanvasRef.current.getContext("2d");
        ctx?.clearRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
      }
    }
  };

  const applyManualEdit = async () => {
    if (!currentImage || currentImage.startsWith("blob:")) return;
    const mediaSessionId = mediaSessionRef.current;
    const runId = ++processingRunRef.current;
    setIsProcessing(true);
    setShowManualTray(false);
    try {
      const result = await renderManualEdit(currentImage, manualEdit);
      if (mediaSessionRef.current !== mediaSessionId || processingRunRef.current !== runId) return;
      pushImage(result, { type: "image", thumbnailUri: result });
      resetManualToolState();
      toast.success("Manual edit applied");
    } catch (error) {
      console.error(error);
      toast.error("Could not apply manual edit.");
    } finally {
      if (mediaSessionRef.current === mediaSessionId && processingRunRef.current === runId) setIsProcessing(false);
    }
  };

  const handleExport = async () => {
    if (!currentImage) return;

    try {
      const exportMode = getExportMode({ tier, usedPremium, category: "photo" });
      const exportQuality = exportMode === "free" ? 0.88 : 0.96;
      if (currentImage.startsWith("blob:")) {
        const { exportVideo } = await import("../lib/videoProcessor");
        const blob = await exportVideo(currentImage, exportMode);
        await saveBlobToDevice(blob, `chromancy-animation-${Date.now()}.mp4`);
      } else {
        const extension = sourceExtension === "jpeg" ? "jpg" : sourceExtension;
        const mimeType = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
        const exportSource = await resolveProcessedPhotoForExport(currentImage);
        const blob = await convertDataUrlToBlob(exportSource, mimeType, exportQuality);
        await saveBlobToDevice(blob, `chromancy-${Date.now()}.${extension || "jpg"}`);
      }
      toast.success("Export saved successfully.");
    } catch (error) {
      console.error(error);
      toast.error("Export failed. Please check storage access and try again.");
    }
  };



  const handleReplace = () => {
    clearPhotoSession();
  };

  const commitPendingManualEdit = useCallback(async () => {
    if (!currentImage || currentImage.startsWith("blob:") || !hasPendingManualEdit(manualEdit)) {
      return currentImage;
    }

    const mediaSessionId = mediaSessionRef.current;
    const runId = ++processingRunRef.current;
    setIsProcessing(true);
    setShowManualTray(false);

    try {
      const result = await renderManualEdit(currentImage, manualEdit);
      if (mediaSessionRef.current !== mediaSessionId || processingRunRef.current !== runId) return null;
      pushImage(result, { type: "image", thumbnailUri: result });
      resetManualToolState({ closeTray: true });
      return result;
    } catch (error) {
      console.error(error);
      toast.error("Could not keep your manual edit.");
      return null;
    } finally {
      if (mediaSessionRef.current === mediaSessionId && processingRunRef.current === runId) {
        setIsProcessing(false);
      }
    }
  }, [currentImage, manualEdit, pushImage, resetManualToolState]);

  const handleToolSelection = useCallback(async (toolId: string) => {
    let sourceOverride: string | undefined;

    if (selectedTool === "manual" && toolId !== "manual") {
      const committed = await commitPendingManualEdit();
      if (committed === null) return;
      sourceOverride = committed || undefined;
    }

    setSelectedTool(toolId);
    setShowManualTray(toolId === "manual");

    if (toolId !== "manual" && toolId !== "pose" && toolId !== "change_bg" && toolId !== "vibe") {
      void handleEnhance(toolId, sourceOverride);
    }
  }, [commitPendingManualEdit, handleEnhance, selectedTool]);

  const scrollManualTray = (direction: "up" | "down") => {
    manualTrayScrollRef.current?.scrollBy({
      top: direction === "up" ? -180 : 180,
      behavior: "smooth",
    });
  };

  const handleScrollHintClick = useCallback(() => {
    const viewport = previewViewportRef.current;
    if (!viewport) return;
    viewport.scrollBy({
      top: Math.max(220, viewport.clientHeight * 0.48),
      behavior: "smooth",
    });
  }, []);

  useEffect(() => {
    if (!currentImage || !canvasRef.current) return;

    const img = new Image();
    img.onload = async () => {
      const canvas = canvasRef.current!;
      const maskCanvas = maskCanvasRef.current!;

      if (selectedTool === "manual" && !currentImage.startsWith("blob:")) {
        const previewUrl = await renderManualEdit(currentImage, manualEdit).catch(() => null);
        if (!previewUrl) return;
        const preview = new Image();
        preview.onload = () => {
          canvas.width = preview.naturalWidth;
          canvas.height = preview.naturalHeight;
          const ctx = canvas.getContext("2d");
          ctx?.clearRect(0, 0, canvas.width, canvas.height);
          ctx?.drawImage(preview, 0, 0);
          maskCanvas.width = canvas.width;
          maskCanvas.height = canvas.height;
          maskCanvas.getContext("2d")?.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        };
        preview.src = previewUrl;
        return;
      }

      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      maskCanvas.width = img.naturalWidth;
      maskCanvas.height = img.naturalHeight;

      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      ctx?.drawImage(img, 0, 0);
    };
    img.src = currentImage;
  }, [currentImage, manualEdit, selectedTool]);

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

  const setCropEdge = (field: "cropX" | "cropY" | "cropWidth" | "cropHeight", value: number) => {
    commitManualState((prev) => ({ ...prev, [field]: value }));
  };

  const shouldShowScrollHint = selectedTool === "change_bg" || selectedTool === "vibe" || selectedTool === "pose";

  useEffect(() => {
    const viewport = previewViewportRef.current;
    const stage = previewStageRef.current;

    const updateScrollHint = () => {
      if (!shouldShowScrollHint || !viewport || !stage || isProcessing || !currentImage) {
        setShowScrollHintOverlay(false);
        return;
      }

      const atTop = viewport.scrollTop <= 64;
      if (!atTop) {
        setShowScrollHintOverlay(false);
        return;
      }

      const viewportRect = viewport.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const visibleTop = Math.max(stageRect.top, viewportRect.top + 12);
      const visibleBottom = Math.min(stageRect.bottom, viewportRect.bottom - 12);
      const visibleHeight = visibleBottom - visibleTop;

      if (visibleHeight < 84 || stageRect.bottom <= viewportRect.top || stageRect.top >= viewportRect.bottom) {
        setShowScrollHintOverlay(false);
        return;
      }

      const nextBottom = Math.max(18, Math.min(stageRect.height - 18, stageRect.bottom - visibleBottom + 18));
      setScrollHintBottom(nextBottom);
      setShowScrollHintOverlay(true);
    };

    updateScrollHint();
    requestAnimationFrame(updateScrollHint);
    viewport.addEventListener("scroll", updateScrollHint, { passive: true });
    window.addEventListener("resize", updateScrollHint);

    return () => {
      viewport.removeEventListener("scroll", updateScrollHint);
      window.removeEventListener("resize", updateScrollHint);
    };
  }, [shouldShowScrollHint, isProcessing, currentImage, selectedTool]);

  const ScrollHint = ({ overlay = false }: { overlay?: boolean }) => (
    <motion.button
      type="button"
      onClick={handleScrollHintClick}
      aria-label="Scroll down"
      initial={{ opacity: 0.55, y: 0 }}
      animate={{ opacity: [0.5, 1, 0.5], y: [0, 7, 0], scale: [1, 1.04, 1] }}
      transition={{ duration: 1.7, repeat: Infinity, ease: "easeInOut" }}
      className={overlay ? "absolute left-1/2 z-30 flex items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70" : "-mt-1 mb-1 flex items-center justify-center rounded-full"}
      style={overlay ? { bottom: `${scrollHintBottom}px`, transform: "translateX(-50%)" } : undefined}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/18 bg-black/58 backdrop-blur-md shadow-[0_12px_34px_rgba(0,0,0,0.34)]">
        <ChevronsDown className="h-5 w-5 text-white/78" />
      </div>
    </motion.button>
  );

  const isManualPanelVisible = selectedTool === "manual" && !!currentImage && !currentImage.startsWith("blob:");
  const previewStageClass = cn(
    "relative flex w-full items-center justify-center rounded-2xl overflow-hidden shadow-2xl",
    isManualPanelVisible && showManualTray ? "h-[28vh] sm:h-[32vh] max-w-[260px] sm:max-w-[300px]" : "max-w-2xl",
  );
  const previewMediaClass = isManualPanelVisible && showManualTray ? "h-full w-full object-contain" : "max-w-full max-h-[70vh] object-contain";

  return (
    <div className="h-full flex flex-col bg-black">
      <div className="p-4 flex items-center justify-between border-b border-white/10 bg-black/50 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="p-2 rounded-xl bg-white/5 disabled:opacity-20 hover:bg-white/10 transition-colors"
          >
            <Undo className="w-5 h-5" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="p-2 rounded-xl bg-white/5 disabled:opacity-20 hover:bg-white/10 transition-colors"
          >
            <Redo className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={cn("p-2 rounded-xl transition-colors", showHistory ? "bg-white text-black" : "bg-white/5 hover:bg-white/10")}
          >
            <History className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={!currentImage}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-black font-bold text-xs uppercase tracking-widest hover:bg-white/90 disabled:opacity-20 transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Export</span>
          </button>
        </div>
      </div>

      <div className="flex-1 relative bg-neutral-900/50">
        <div ref={previewViewportRef} className="visible-scrollbar absolute inset-0 overflow-y-auto p-4 pr-2">
          <div className={cn("min-h-full flex flex-col items-center justify-center gap-6", isManualPanelVisible ? (showManualTray ? "pb-[24rem] sm:pb-[26rem]" : "pb-40") : "pb-32")}>
          <section className="w-full max-w-3xl space-y-2 text-center">
            <h2 className="text-2xl font-bold tracking-tight rainbow-text">{PHOTO_TAB_TITLE}</h2>
            <p className="text-sm text-white/50">{PHOTO_TAB_DESCRIPTION}</p>
          </section>
          <AnimatePresence mode="wait">
            {!currentImage ? (
              <motion.div
                {...getRootProps()}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className={cn(
                  "w-full max-w-md aspect-[3/4] rounded-3xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center p-8 text-center transition-all cursor-pointer",
                  isDragActive ? "bg-white/10 border-white/30" : "bg-white/5 hover:bg-white/10 hover:border-white/20"
                )}
              >
                <input {...getInputProps()} />
                <div className="p-6 rounded-full bg-white/5 mb-6">
                  <Upload className="w-12 h-12 text-white/30" />
                </div>
                <h3 className="text-xl font-bold mb-2">Upload Photo</h3>
                <p className="text-sm text-white/40 mb-8">JPEG, PNG, and WEBP files supported.</p>
                <button className="px-8 py-3 rounded-full bg-white text-black font-bold uppercase tracking-widest hover:bg-white/90 transition-colors">
                  Choose File
                </button>
              </motion.div>
            ) : (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative w-full flex flex-col items-center gap-6 transition-all duration-300">
                <div ref={previewStageRef} className={previewStageClass}>
                  {currentImage.startsWith("blob:") ? (
                    <PreviewRenderer result={{ type: "video", uri: currentImage }} alt="Processed preview" autoPlay loop muted className={previewMediaClass} />
                  ) : (
                    <canvas ref={canvasRef} className={previewMediaClass} />
                  )}
                  <canvas
                    ref={maskCanvasRef}
                    className="absolute inset-0 w-full h-full pointer-events-none opacity-0"
                  />

                  {selectedTool === "manual" && !currentImage.startsWith("blob:") && (
                    <div className="pointer-events-none absolute inset-0 border border-white/15">
                      <div
                        className="absolute border-2 border-white/80 rounded-xl"
                        style={{
                          left: `${manualEdit.cropX}%`,
                          top: `${manualEdit.cropY}%`,
                          width: `${manualEdit.cropWidth}%`,
                          height: `${manualEdit.cropHeight}%`,
                        }}
                      />
                    </div>
                  )}

                  {isProcessing && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4 z-50">
                      <div className="w-12 h-12 border-4 border-white/10 border-t-white rounded-full animate-spin" />
                      <p className="text-xs font-bold uppercase tracking-[0.2em] animate-pulse">AI is working...</p>
                    </div>
                  )}

                  {showScrollHintOverlay && <ScrollHint overlay />}

                </div>

                {isManualPanelVisible && showManualTray && (
                  <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="fixed inset-x-4 z-40 pointer-events-none"
                    style={{ bottom: `${manualTrayBottomOffset}px` }}
                  >
                    <div className="pointer-events-auto mx-auto w-full max-w-md rounded-[1.75rem] border border-white/10 bg-black/84 backdrop-blur-xl shadow-2xl overflow-hidden transition-all duration-300 h-[30vh] sm:h-[32vh]">
                      <div className="flex h-12 w-full items-center justify-between gap-3 border-b border-white/10 bg-white/[0.06] px-4 text-white/75">
                        <div className="flex items-center gap-2">
                          <Scissors className="w-4 h-4" />
                          <span className="text-[10px] font-bold uppercase tracking-[0.18em]">Manual Edit</span>
                        </div>
                        <button onClick={closeManualTray} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-white hover:bg-white/20 transition-colors">
                          <ChevronsDown className="w-3.5 h-3.5" /> Close tray
                        </button>
                      </div>
                      {showManualTray && (
                        <div ref={manualTrayScrollRef} className="manual-scrollbar h-[calc(30vh-3rem)] overflow-y-auto p-4 space-y-3 sm:h-[calc(32vh-3rem)]">
                          <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-2 flex items-center justify-between gap-3 bg-gradient-to-b from-black via-black/95 to-black/80 px-4 pb-3 pt-4 text-white/75 backdrop-blur-sm">
                            <button onClick={applyManualEdit} disabled={!currentImage || isProcessing} className="w-[46%] min-w-[132px] py-2.5 rounded-xl bg-white text-black font-bold text-[10px] uppercase tracking-[0.16em] hover:bg-white/90 disabled:opacity-20 transition-all flex items-center justify-center gap-1.5">
                              <Sparkles className="w-4 h-4" />
                              <span>Apply edit</span>
                            </button>
                            <div className="flex items-center gap-2">
                              <button onClick={() => scrollManualTray("up")} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors" aria-label="Scroll up"><ChevronUp className="w-4 h-4" /></button>
                              <button onClick={() => scrollManualTray("down")} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors" aria-label="Scroll down"><ChevronDown className="w-4 h-4" /></button>
                              <button onClick={undoManualEdit} disabled={manualHistoryIndex === 0} className="p-1.5 rounded-lg bg-white/5 disabled:opacity-25 hover:bg-white/10 transition-colors"><Undo className="w-4 h-4" /></button>
                              <button onClick={redoManualEdit} disabled={manualHistoryIndex >= manualHistory.length - 1} className="p-1.5 rounded-lg bg-white/5 disabled:opacity-25 hover:bg-white/10 transition-colors"><Redo className="w-4 h-4" /></button>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 gap-2.5">
                            <label className="space-y-2"><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Crop left</span><input type="range" min={0} max={95} value={manualEdit.cropX} onChange={(e) => setCropEdge("cropX", Number(e.target.value))} className="block w-1/2 mx-auto" /></label>
                            <label className="space-y-2"><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Crop top</span><input type="range" min={0} max={95} value={manualEdit.cropY} onChange={(e) => setCropEdge("cropY", Number(e.target.value))} className="block w-1/2 mx-auto" /></label>
                            <label className="space-y-2"><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Crop width</span><input type="range" min={5} max={100 - manualEdit.cropX} value={manualEdit.cropWidth} onChange={(e) => setCropEdge("cropWidth", Number(e.target.value))} className="block w-1/2 mx-auto" /></label>
                            <label className="space-y-2"><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Crop height</span><input type="range" min={5} max={100 - manualEdit.cropY} value={manualEdit.cropHeight} onChange={(e) => setCropEdge("cropHeight", Number(e.target.value))} className="block w-1/2 mx-auto" /></label>
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
                                <button key={filter.id} onClick={() => commitManualState((prev) => ({ ...prev, filter: filter.id }))} className={cn("flex-shrink-0 px-3 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-[0.18em] transition-all", manualEdit.filter === filter.id ? "bg-white text-black border-white" : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10")}>{filter.label}</button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}

                {selectedTool === "change_bg" && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md space-y-4 px-4">
                    <input
                      type="text"
                      placeholder="Describe new background (e.g. sunset beach, garden...)"
                      value={bgPrompt}
                      onChange={(e) => setBgPrompt(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-white/30 transition-all"
                    />
                    <button
                      onClick={() => handleEnhance("change_bg")}
                      disabled={!currentImage || isProcessing || !bgPrompt}
                      className="w-full py-4 rounded-2xl bg-white text-black font-bold uppercase tracking-[0.2em] hover:bg-white/90 disabled:opacity-20 transition-all flex items-center justify-center gap-2"
                    >
                      {isProcessing ? <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      <span>Generate Background</span>
                    </button>
                  </motion.div>
                )}


                {selectedTool === "pose" && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md space-y-4 px-4">
                    <input
                      type="text"
                      placeholder="Describe pose adjustment (e.g. fix hand, stand straighter...)"
                      value={posePrompt}
                      onChange={(e) => setPosePrompt(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-white/30 transition-all"
                    />
                    <button
                      onClick={() => handleEnhance("pose")}
                      disabled={!currentImage || isProcessing || !posePrompt}
                      className="w-full py-4 rounded-2xl bg-white text-black font-bold uppercase tracking-[0.2em] hover:bg-white/90 disabled:opacity-20 transition-all flex items-center justify-center gap-2"
                    >
                      {isProcessing ? <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      <span>Generate Pose</span>
                    </button>
                  </motion.div>
                )}

                {selectedTool === "vibe" && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md space-y-4 px-4">
                    <select
                      value={vibePrompt}
                      onChange={(e) => setVibePrompt(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-white/30 transition-all"
                    >
                      <option value="">Choose a vibe</option>
                      <option value="Cinematic: cinematic portrait, dramatic lighting, teal and orange color grading, high contrast, film still look, sharp details, subtle grain, depth, professional movie scene aesthetic">Cinematic</option>
                      <option value="Golden Hour: golden hour portrait, warm sunlight, soft glowing skin, sunlit highlights, natural light, warm tones, soft shadows, dreamy atmosphere, outdoor lighting feel">Golden Hour</option>
                      <option value="Nature: natural aesthetic portrait, fresh green tones, soft natural light, vibrant but realistic colors, outdoor feel, clean air look, balanced exposure, calming environment">Nature</option>
                      <option value="Clean Girl Aesthetic: clean girl aesthetic portrait, natural glowing skin, soft diffused lighting, minimal makeup look, neutral tones, bright and airy, subtle skin smoothing, clean background, high-end lifestyle aesthetic">Clean Girl Aesthetic</option>
                      <option value="Indie: indie aesthetic portrait, film grain, muted faded colors, soft blur, vintage tones, tumblr style, slightly lifted blacks, candid artistic vibe, imperfect texture">Indie</option>
                      <option value="Backlit: backlit portrait, strong light source behind subject, glowing rim light around hair, soft haze, subtle lens flare, warm highlights, cinematic lighting, natural skin tones">Backlit</option>
                      <option value="Spotlight: spotlight portrait, dramatic studio lighting, dark background, face illuminated, high contrast, strong shadows, subject isolated, cinematic portrait lighting">Spotlight</option>
                      <option value="Neon Cyberpunk: cyberpunk portrait, neon pink and blue lighting, futuristic atmosphere, glowing highlights, dark background, high contrast, reflective lighting, night city aesthetic">Neon Cyberpunk</option>
                    </select>
                    <button
                      onClick={() => handleEnhance("vibe")}
                      disabled={!currentImage || isProcessing || !vibePrompt}
                      className="w-full py-4 rounded-2xl bg-white text-black font-bold uppercase tracking-[0.2em] hover:bg-white/90 disabled:opacity-20 transition-all flex items-center justify-center gap-2"
                    >
                      {isProcessing ? <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      <span>Generate Vibe</span>
                    </button>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

          </div>
        <HistoryDrawer open={showHistory} title="Photo history" items={historyEntries} currentItem={currentImage} onClose={() => setShowHistory(false)} onSelect={selectHistory} />
      </div>

      <div ref={bottomToolBarRef} className="safe-area-bottom bg-black/80 backdrop-blur-md border-t border-white/10 p-4">
        <div className="visible-horizontal-scrollbar flex gap-3 overflow-x-auto pb-2">
          <button
            onClick={handleReplace}
            className="flex-shrink-0 flex flex-col items-center justify-center gap-2 p-4 rounded-3xl border border-red-500/20 bg-red-500/5 text-red-400 min-w-[100px] hover:bg-red-500/10 transition-all"
          >
            <RotateCcw className="w-6 h-6" />
            <p className="text-[10px] font-bold uppercase leading-none">Replace</p>
          </button>

          {FREE_TOOLS.map((tool) => (
            <button
              key={tool.id}
              onClick={() => { void handleToolSelection(tool.id); }}
              className={cn(
                "flex-shrink-0 flex flex-col items-center gap-2 p-4 rounded-3xl border transition-all min-w-[100px]",
                selectedTool === tool.id ? "bg-white text-black border-white" : "bg-white/5 text-white border-white/10 hover:border-white/20"
              )}
            >
              <div className="relative">
                <tool.icon className="w-6 h-6" />
                {getToolConfig(UI_TOOL_TO_INTERNAL_ID[tool.id])?.isAi && getToolConfig(UI_TOOL_TO_INTERNAL_ID[tool.id])?.pricingTier !== "free" ? (
                  <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-yellow-400 border border-black" />
                ) : null}
              </div>
              <div className="text-center">
                <p className="text-[10px] font-bold uppercase leading-none">{tool.label}</p>
                <p className={cn("text-[8px] mt-1", selectedTool === tool.id ? "text-black/60" : "text-white/72")}>{tool.description}</p>
              </div>
            </button>
          ))}
          <div className="w-px h-12 bg-white/10 self-center" />
          {PREMIUM_TOOLS.map((tool) => (
            <button
              key={tool.id}
              onClick={() => { void handleToolSelection(tool.id); }}
              className={cn(
                "flex-shrink-0 flex flex-col items-center gap-2 p-4 rounded-3xl border transition-all min-w-[100px]",
                selectedTool === tool.id ? "bg-white text-black border-white" : "bg-white/5 text-white border-white/10 hover:border-white/20"
              )}
            >
              <div className="relative">
                <tool.icon className="w-6 h-6" />
                <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-yellow-400 border border-black" />
              </div>
              <div className="text-center">
                <p className="text-[10px] font-bold uppercase leading-none">{tool.label}</p>
                {getToolConfig(UI_TOOL_TO_INTERNAL_ID[tool.id])?.trialEligible ? (
                  <p className={cn("mt-1 text-[7px] font-bold uppercase tracking-[0.16em]", selectedTool === tool.id ? "text-black/70" : "text-yellow-300")}>Free trial</p>
                ) : null}
                <p className={cn("text-[8px] mt-1", selectedTool === tool.id ? "text-black/60" : "text-white/72")}>{tool.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
