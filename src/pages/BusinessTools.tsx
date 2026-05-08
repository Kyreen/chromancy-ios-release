import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Box,
  Utensils,
  Camera,
  Sparkles,
  TrendingUp,
  ShieldCheck,
  Upload,
  X,
  Download,
  Loader2,
  Undo,
  Redo,
  RotateCcw,
  History,
  ChevronsDown,
  ChevronLeft,
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { cn } from "../lib/utils";
import { cancelActiveAiRequests, createBusinessGraphic, enhancePhoto, getAiRequestErrorMessage, isAiGenerationCancelledError, predictPerformance, requestAiSpendConfirmation } from "../lib/gemini";
import { ensureApiKey, isLoginRequiredError } from "../lib/auth-utils";
import { auth } from "../lib/firebase";
import { UserTier } from "../types";
import { usePhotoStack } from "../lib/usePhotoStack";
import { renderPdfFirstPage } from "../lib/media-utils";
import { blobFromDataUrl, convertDataUrlToBlob, normaliseExportTarget, sanitizeExtension, saveBlobToDevice } from "../lib/exportMedia";
import { jsPDF } from "jspdf";
import { HistoryDrawer } from "../components/HistoryDrawer";
import { CREATE_TYPE_CONFIG, CREATE_TYPE_ORDER, getCreateDefaultValues, getCreateFormat, type CreateUseType } from "../lib/createGraphicConfig";
import { getToolConfig, UI_TOOL_TO_INTERNAL_ID } from "../lib/toolConfig";
import { getExportMode } from "../lib/exportRules";

interface BusinessToolsProps {
  tier?: UserTier;
  onNavigate?: (tab: string) => void;
}

type LevelUpToolId = "mockup" | "food" | "studio" | "pro" | "create" | "predict";
type ExportTargetState = {
  mimeType: string;
  extension: string;
  transparent?: boolean;
};

const LEVEL_UP_TITLE = "Level Up";
const LEVEL_UP_DESCRIPTION = "Turn content into high-performing assets.";
const MAX_CREATE_REFERENCE_IMAGES = 6;
const LEVEL_UP_IMAGE_OPTIONS = { imageSize: "2K" as const };
const LEVEL_UP_FACE_AND_TEXT_GUARD =
  "Hard quality rules: preserve all faces, body shapes, hands, hairlines, logos, products, packaging, and important scene details exactly. Do not morph people, beautify by changing facial geometry, face-swap, change ethnicity, change age, change expression anatomy, distort hands, or alter identity. Do not add any new words, fake letters, glyphs, watermarks, signatures, app names, labels, prices, contact details, or filler copy. If text is not explicitly supplied by the user or already present in the uploaded image, leave text out. Finish with a clean premium commercial result, not a generic AI effect.";

async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

async function loadImageElement(source: string) {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to prepare preview image."));
    image.src = source;
  });
}

async function fitGraphicToCanvas(source: string, width: number, height: number, transparent = false) {
  const image = await loadImageElement(source);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return source;

  if (!transparent) {
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, width, height);
  }

  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;

  ctx.drawImage(image, x, y, drawWidth, drawHeight);
  return canvas.toDataURL("image/png", 0.98);
}

function colorDistance(a: [number, number, number], b: [number, number, number]) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

function isLikelyTransparentBgPixel(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const brightness = (r + g + b) / 3;
  return max - min <= 42 && brightness >= 118;
}

function stripEdgeBackgroundToTransparent(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  const seedColors: [number, number, number][] = [];
  const seedPoints = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
    [Math.floor(width / 2), 0],
    [Math.floor(width / 2), height - 1],
    [0, Math.floor(height / 2)],
    [width - 1, Math.floor(height / 2)],
  ];

  for (const [x, y] of seedPoints) {
    const offset = (y * width + x) * 4;
    const alpha = data[offset + 3];
    if (alpha < 10) continue;
    seedColors.push([data[offset], data[offset + 1], data[offset + 2]]);
  }

  if (!seedColors.length) return;

  const matchesSeed = (pixelIndex: number) => {
    const offset = pixelIndex * 4;
    const alpha = data[offset + 3];
    if (alpha < 10) return true;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    if (!isLikelyTransparentBgPixel(r, g, b)) return false;
    return seedColors.some((seed) => colorDistance(seed, [r, g, b]) <= 78);
  };

  const enqueue = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixelIndex = y * width + x;
    if (visited[pixelIndex]) return;
    visited[pixelIndex] = 1;
    if (!matchesSeed(pixelIndex)) return;
    queue.push(pixelIndex);
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  let cleared = 0;
  while (queue.length) {
    const pixelIndex = queue.pop()!;
    const offset = pixelIndex * 4;
    data[offset + 3] = 0;
    cleared += 1;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  if (!cleared) return;

  ctx.putImageData(imageData, 0, 0);
}

async function prepareTransparentGraphic(source: string, width: number, height: number) {
  const fitted = await fitGraphicToCanvas(source, width, height, true);
  const image = await loadImageElement(fitted);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return fitted;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  stripEdgeBackgroundToTransparent(canvas);
  return canvas.toDataURL("image/png", 0.98);
}

function normaliseCopySpacing(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+([)\]}])/g, "$1")
    .trim();
}

function sanitiseCreateTextValues(values: Record<string, string>) {
  return Object.entries(values).reduce<Record<string, string>>((acc, [key, value]) => {
    acc[key] = normaliseCopySpacing(value || "");
    return acc;
  }, {});
}

async function buildSvgGraphic(dataUrl: string) {
  const image = await loadImageElement(dataUrl);
  const safeUrl = dataUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${image.naturalWidth}" height="${image.naturalHeight}" viewBox="0 0 ${image.naturalWidth} ${image.naturalHeight}">
  <image href="${safeUrl}" width="${image.naturalWidth}" height="${image.naturalHeight}" preserveAspectRatio="xMidYMid meet" />
</svg>`;
}

export function BusinessTools({ tier = "free", onNavigate }: BusinessToolsProps) {
  void onNavigate;

  useEffect(() => {
    return () => {
      cancelActiveAiRequests();
    };
  }, []);

  const {
    currentImage: file,
    historyEntries,
    pushImage: setFile,
    undo,
    redo,
    reset,
    canUndo,
    selectHistory,
    canRedo,
  } = usePhotoStack(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [usedPremium, setUsedPremium] = useState(false);
  const [activeTool, setActiveTool] = useState<LevelUpToolId | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [prediction, setPrediction] = useState<{ score: number; reasoning: string } | null>(null);
  const [mockupPrompt, setMockupPrompt] = useState("");
  const [proText, setProText] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [createUseType, setCreateUseType] = useState<CreateUseType | null>(null);
  const [createOutputFormat, setCreateOutputFormat] = useState("");
  const [createFormValues, setCreateFormValues] = useState<Record<string, string>>({});
  const [createNotes, setCreateNotes] = useState("");
  const [createAdditionalText, setCreateAdditionalText] = useState("");
  const [createReferenceImages, setCreateReferenceImages] = useState<string[]>([]);
  const [isCreateStudioOpen, setIsCreateStudioOpen] = useState(false);
  const [currentExportTarget, setCurrentExportTarget] = useState<ExportTargetState | null>(null);
  const [sourceMimeType, setSourceMimeType] = useState<string>("image/jpeg");
  const [sourceExtension, setSourceExtension] = useState<string>("jpg");
  const mediaSessionRef = useRef(0);
  const processingRunRef = useRef(0);
  const previewViewportRef = useRef<HTMLDivElement>(null);
  const previewStageRef = useRef<HTMLDivElement>(null);
  const [showScrollHintOverlay, setShowScrollHintOverlay] = useState(false);
  const [scrollHintBottom, setScrollHintBottom] = useState(18);
  const shouldShowScrollHint = activeTool === "mockup" || activeTool === "pro";
  const createConfig = createUseType ? CREATE_TYPE_CONFIG[createUseType] : null;
  const createFormatConfig = getCreateFormat(createUseType, createOutputFormat);

  const tools = useMemo(
    () => [
      { id: "mockup" as const, icon: Box, label: "Mockup Generator", description: "Place your visuals into real-world scenes" },
      { id: "food" as const, icon: Utensils, label: "Food Enhancer", description: "Make food look delicious" },
      { id: "studio" as const, icon: Camera, label: "Studio Shot", description: "Product to studio-quality" },
      { id: "pro" as const, icon: Sparkles, label: "BRAND PHOTO", description: "Brand photos professionally" },
      { id: "create" as const, icon: Sparkles, label: "CREATE", description: "Create a professional graphic" },
      { id: "predict" as const, icon: TrendingUp, label: "Smart Performance Predictor", description: "Predict likely performance" },
    ],
    [],
  );

  const clearCreateDraft = () => {
    setCreateUseType(null);
    setCreateOutputFormat("");
    setCreateFormValues({});
    setCreateNotes("");
    setCreateAdditionalText("");
    setCreateReferenceImages([]);
    setLogo(null);
  };

  const clearBusinessDrafts = () => {
    setMockupPrompt("");
    setProText("");
    clearCreateDraft();
  };

  const selectCreateType = (nextType: CreateUseType) => {
    setCreateUseType(nextType);
    setCreateOutputFormat(CREATE_TYPE_CONFIG[nextType].formats[0]?.value || "");
    setCreateFormValues(getCreateDefaultValues(nextType));
    setCreateNotes("");
    setCreateAdditionalText("");
    setCreateReferenceImages([]);
    setLogo(null);
  };

  const onDropLogo = async (acceptedFiles: File[]) => {
    const incomingFile = acceptedFiles[0];
    if (!incomingFile) return;
    try {
      setLogo(await readFileAsDataUrl(incomingFile));
    } catch {
      toast.error("Could not load logo.");
    }
  };

  const onDropCreateAssets = async (acceptedFiles: File[]) => {
    const maxImages = createConfig?.maxImages ?? MAX_CREATE_REFERENCE_IMAGES;
    const remainingSlots = Math.max(0, maxImages - createReferenceImages.length);
    const nextFiles = acceptedFiles.slice(0, remainingSlots);
    if (!nextFiles.length) return;

    try {
      const nextAssets = await Promise.all(nextFiles.map(readFileAsDataUrl));
      setCreateReferenceImages((prev) => [...prev, ...nextAssets].slice(0, maxImages));
    } catch {
      toast.error("Could not load the extra images.");
    }
  };

  const { getRootProps: getLogoRootProps, getInputProps: getLogoInputProps } = useDropzone({
    onDrop: onDropLogo,
    accept: { "image/*": [".png", ".jpeg", ".jpg"] },
    multiple: false,
  } as any);

  const { getRootProps: getCreateAssetsRootProps, getInputProps: getCreateAssetsInputProps } = useDropzone({
    onDrop: onDropCreateAssets,
    accept: { "image/*": [".png", ".jpeg", ".jpg", ".webp"] },
    multiple: true,
  } as any);

  const onDrop = async (acceptedFiles: File[]) => {
    const incomingFile = acceptedFiles[0];
    if (!incomingFile) return;
    setUsedPremium(false);
    mediaSessionRef.current += 1;
    processingRunRef.current += 1;
    setIsProcessing(false);
    setPrediction(null);
    setActiveTool(null);
    setIsCreateStudioOpen(false);
    clearBusinessDrafts();
    setCurrentExportTarget(null);

    setSourceMimeType(incomingFile.type || "image/jpeg");
    setSourceExtension(sanitizeExtension(incomingFile.name.split(".").pop()) || "jpg");

    if (incomingFile.type === "application/pdf") {
      try {
        const result = await renderPdfFirstPage(incomingFile, 1.5);
        reset(result);
      } catch {
        toast.error("Failed to load PDF");
      }
      return;
    }

    try {
      reset(await readFileAsDataUrl(incomingFile));
    } catch {
      toast.error("Failed to load image.");
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".jpeg", ".jpg", ".png", ".webp"], "application/pdf": [".pdf"] },
    multiple: false,
  } as any);

  const handleProcess = async (toolId: LevelUpToolId) => {
    if (toolId !== "create" && !file) {
      toast.error("Upload a visual first.");
      return;
    }

    const mediaSessionId = mediaSessionRef.current;
    let runId = 0;
    const aiMeta = { toolId: UI_TOOL_TO_INTERNAL_ID[toolId], tier };

    if (toolId === "create") {
      const cleanedFields = sanitiseCreateTextValues(createFormValues);
      const cleanedNotes = normaliseCopySpacing(createNotes);
      const cleanedAdditionalText = normaliseCopySpacing(createAdditionalText);

      if (!createUseType || !createConfig || !createFormatConfig) {
        toast.error("Choose a category and output format first.");
        return;
      }

      const missingField = createConfig.fields.find((field) => field.required && !cleanedFields[field.id]?.trim());
      if (missingField) {
        toast.error(`Please fill in ${missingField.label.toLowerCase()}.`);
        return;
      }

      if (createConfig.allowImages && (createConfig.minImages || 0) > createReferenceImages.length) {
        toast.error(`Please add at least ${createConfig.minImages} image${createConfig.minImages === 1 ? "" : "s"}.`);
        return;
      }

      setCreateFormValues(cleanedFields);
      setCreateNotes(cleanedNotes);
      setCreateAdditionalText(cleanedAdditionalText);
    }

    if (!auth.currentUser) {
      toast.error("Please log in before using AI tools.");
      onNavigate?.("auth");
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

    runId = ++processingRunRef.current;
    setIsProcessing(true);
    setPrediction(null);
    setActiveTool(toolId);

    try {
      await ensureApiKey();

      if (toolId === "predict") {
        const result = await predictPerformance(file!, aiMeta);
        if (mediaSessionRef.current !== mediaSessionId || processingRunRef.current !== runId) return;
        setPrediction(result);
        toast.success("Analysis ready!");
        return;
      }

      let result: string;

      switch (toolId) {
        case "mockup":
          result = await enhancePhoto(
            file!,
            `Create a realistic premium mockup using this uploaded design or visual. Mockup request: ${mockupPrompt || "professional billboard, poster, packaging, product shot, storefront, or branded scene"}. Treat the uploaded artwork, logo, product, person, or design as the hero asset and preserve it faithfully. Place it into a believable real-world scene with correct perspective, correct scale, print/material realism, premium lighting, natural reflections, contact shadows, clean edges, sharp detail, and expensive commercial presentation. The scene must feel photographed by a professional brand campaign team, not like a pasted sticker. Do not crop away important content. Do not invent unrelated people, products, extra logos, sales copy, labels, signage, slogans, watermarks, app names, or fake brand details. ${LEVEL_UP_FACE_AND_TEXT_GUARD}`,
            undefined,
            { ...aiMeta, ...LEVEL_UP_IMAGE_OPTIONS },
          );
          setCurrentExportTarget(null);
          break;
        case "food":
          result = await enhancePhoto(
            file!,
            `Make this food photo look like it was shot by a professional food photographer for a premium restaurant or luxury menu campaign. Improve appetite appeal, true-to-life color, freshness, gloss highlights, texture detail, steam/freshness cues only where naturally plausible, plating polish, clean shadow depth, balanced exposure, editorial contrast, and crisp commercial finish. Preserve the actual dish, plate, ingredients, camera angle, composition, portion size, tableware, and scene identity. Do not turn it into different food, do not add ingredients that were not there, do not make it cartoonish, and do not use fake plastic-looking shine. ${LEVEL_UP_FACE_AND_TEXT_GUARD}`,
            undefined,
            { ...aiMeta, ...LEVEL_UP_IMAGE_OPTIONS },
          );
          setCurrentExportTarget(null);
          break;
        case "studio":
          result = await enhancePhoto(
            file!,
            `Turn this uploaded product or brand photo into a polished professional studio shot with premium commercial lighting, controlled background, clean shadows, natural reflections, crisp product detail, balanced tones, refined depth, and an expensive advertising finish. Preserve the exact product, subject shape, logo, packaging details, colors, proportions, material texture, and identity. Do not replace the product, redesign it, change its label, or create a different version. ${LEVEL_UP_FACE_AND_TEXT_GUARD}`,
            undefined,
            { ...aiMeta, ...LEVEL_UP_IMAGE_OPTIONS },
          );
          setCurrentExportTarget(null);
          break;
        case "pro":
          result = await enhancePhoto(
            file!,
            `Brand this uploaded photo at a premium commercial level without turning it into a separate poster. Keep the original photo as the main image and preserve the subject, crop, scene, face, body, product details, and photo identity exactly. ${logo ? "Integrate the provided logo as a polished brand mark with correct proportions, clean edges, tasteful placement, and premium restraint. Do not redraw, restyle, misshape, or corrupt the logo." : "No logo was provided, so do not invent a logo or brand mark."} ${proText.trim() ? `Add only this exact user-provided text, spelled exactly: "${proText.trim()}". Do not add any other words.` : "No text was provided, so do not add any words, slogans, labels, or captions."} Use a refined luxury lower-third, soft lower fade, translucent editorial panel, elegant corner lockup, or tasteful gradient brand band only if it improves the photo. Use premium typography only for user-provided text, strong hierarchy, disciplined margins, clean alignment, refined shadows, and commercial social-ad polish. ${LEVEL_UP_FACE_AND_TEXT_GUARD}`,
            logo || undefined,
            { ...aiMeta, ...LEVEL_UP_IMAGE_OPTIONS },
          );
          setCurrentExportTarget(null);
          break;
        case "create": {
          const cleanFormValues = sanitiseCreateTextValues(createFormValues);
          const cleanAdditionalText = normaliseCopySpacing(createAdditionalText);
          setCurrentExportTarget({
            mimeType: createFormatConfig!.mimeType,
            extension: createFormatConfig!.extension,
            transparent: createFormatConfig!.transparent,
          });
          result = await createBusinessGraphic({
            useType: createUseType!,
            fields: cleanFormValues,
            notes: normaliseCopySpacing(createNotes),
            additionalText: cleanAdditionalText,
            additionalImageUrls: createReferenceImages,
            logoUrl: logo || undefined,
            outputFormat: createFormatConfig!.label,
            canvasSize: createConfig!.canvasSize,
            promptFormat: createConfig!.promptFormat,
            promptDirection: createConfig!.promptDirection,
            transparentBackground: !!createFormatConfig!.transparent,
            ...aiMeta,
          });
          break;
        }
        default:
          throw new Error("Unsupported LEVEL UP tool.");
      }

      if (mediaSessionRef.current !== mediaSessionId || processingRunRef.current !== runId) return;
      const toolConfig = getToolConfig(UI_TOOL_TO_INTERNAL_ID[toolId]);
      if (toolConfig?.isAi && toolConfig.pricingTier !== "free") {
        setUsedPremium(true);
      }
      setFile(result, { type: "image", thumbnailUri: result });
      if (toolId === "create") {
        clearBusinessDrafts();
        setIsCreateStudioOpen(false);
        setActiveTool(null);
      }
      toast.success("Processing complete!");
    } catch (error: any) {
      console.error("LEVEL UP processing failed", error);

      if (isAiGenerationCancelledError(error)) {
        return;
      }

      if (isLoginRequiredError(error)) {
        toast.error("Please log in before using AI tools.");
        onNavigate?.("auth");
        return;
      }

      toast.error(getAiRequestErrorMessage(error, "Processing failed. Please try again."));
    } finally {
      if (mediaSessionRef.current === mediaSessionId && processingRunRef.current === runId) {
        setIsProcessing(false);
      }
    }
  };

  const handleExport = async () => {
    if (!file) return;

    try {
      const exportMode = getExportMode({ tier, usedPremium, category: "business" });
      const exportQuality = exportMode === "free" ? 0.88 : 0.96;
      const target = currentExportTarget || normaliseExportTarget({ mimeType: sourceMimeType, extension: sourceExtension }, "image/jpeg");

      if (target.mimeType === "application/pdf") {
        const imageBlob = await blobFromDataUrl(file);
        const imageUrl = URL.createObjectURL(imageBlob);
        try {
          const img = await loadImageElement(imageUrl);

          const pdf = new jsPDF({
            orientation: img.naturalWidth > img.naturalHeight ? "l" : "p",
            unit: "px",
            format: [img.naturalWidth, img.naturalHeight],
            hotfixes: ["px_scaling"],
          });
          pdf.addImage(file, "PNG", 0, 0, img.naturalWidth, img.naturalHeight, undefined, "FAST");
          const pdfBlob = pdf.output("blob");
          await saveBlobToDevice(pdfBlob, `chromancy-level-up-${Date.now()}.pdf`);
        } finally {
          URL.revokeObjectURL(imageUrl);
        }
      } else if (target.mimeType === "image/svg+xml") {
        const svgText = await buildSvgGraphic(file);
        await saveBlobToDevice(new Blob([svgText], { type: "image/svg+xml" }), `chromancy-level-up-${Date.now()}.svg`);
      } else if (target.mimeType === "image/png" && file.startsWith("data:image/png")) {
        await saveBlobToDevice(await blobFromDataUrl(file), `chromancy-level-up-${Date.now()}.png`);
      } else {
        const exportedBlob = await convertDataUrlToBlob(file, target.mimeType, exportQuality);
        await saveBlobToDevice(exportedBlob, `chromancy-level-up-${Date.now()}.${target.extension}`);
      }

      toast.success("Export saved successfully.");
    } catch (error) {
      console.error("LEVEL UP export failed", error);
      toast.error("Export failed. Please try again.");
    }
  };

  useEffect(() => {
    const viewport = previewViewportRef.current;
    const stage = previewStageRef.current;

    const updateScrollHint = () => {
      if (!shouldShowScrollHint || !viewport || !stage || isProcessing || !file) {
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
  }, [shouldShowScrollHint, isProcessing, file, activeTool]);

  const handleScrollHintClick = () => {
    const viewport = previewViewportRef.current;
    if (!viewport) return;
    viewport.scrollBy({
      top: Math.max(220, viewport.clientHeight * 0.48),
      behavior: "smooth",
    });
  };

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

  const renderLogoUploader = (label: string) => (
    <div
      {...getLogoRootProps()}
      className={cn(
        "w-full p-4 rounded-2xl border-2 border-dashed border-white/10 bg-white/5 text-center cursor-pointer hover:bg-white/10 transition-all",
        logo && "border-green-500/50 bg-green-500/5",
      )}
    >
      <input {...getLogoInputProps()} />
      {logo ? (
        <div className="flex items-center justify-center gap-3">
          <img src={logo} className="w-9 h-9 object-contain rounded" />
          <span className="text-[10px] font-bold uppercase text-green-400">Logo Uploaded</span>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2 text-white/40">
          <Upload className="w-4 h-4" />
          <span className="text-[10px] font-bold uppercase">{label}</span>
        </div>
      )}
    </div>
  );

  const closeCreateStudio = () => {
    setIsCreateStudioOpen(false);
    clearBusinessDrafts();
    if (activeTool === "create") {
      setActiveTool(null);
    }
  };

  const handleToolPress = (toolId: LevelUpToolId) => {
    if (toolId === "create") {
      setPrediction(null);
      clearBusinessDrafts();
      setActiveTool("create");
      setIsCreateStudioOpen(true);
      return;
    }

    if (!file) {
      toast.error("Upload a visual first.");
      return;
    }

    if (toolId === "mockup" || toolId === "pro") {
      clearBusinessDrafts();
      setActiveTool(toolId);
      return;
    }

    clearBusinessDrafts();
    void handleProcess(toolId);
  };

  const handleHistorySelect = (index: number) => {
    setCurrentExportTarget(null);
    selectHistory(index);
  };

  return (
    <div className="flex flex-col h-full bg-black">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/2">
        <div className="flex gap-4">
          <button onClick={undo} disabled={!canUndo} className="p-1 text-white/40 hover:text-white transition-colors disabled:opacity-20">
            <Undo className="w-5 h-5" />
          </button>
          <button onClick={redo} disabled={!canRedo} className="p-1 text-white/40 hover:text-white transition-colors disabled:opacity-20">
            <Redo className="w-5 h-5" />
          </button>
          <button onClick={() => setShowHistory((open) => !open)} className={cn("p-1 transition-colors", showHistory ? "text-white" : "text-white/40 hover:text-white")}>
            <History className="w-5 h-5" />
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            disabled={!file}
            className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-xs font-bold uppercase tracking-widest hover:bg-white/20 transition-all disabled:opacity-20"
          >
            <Download className="w-3 h-3" />
            Export
          </button>
        </div>
      </div>

      <div ref={previewViewportRef} className="visible-scrollbar flex-1 relative overflow-y-auto p-4 pr-2">
        <div className="min-h-full flex flex-col items-center gap-6 pb-28">
          <section className="w-full max-w-3xl space-y-2 text-center">
            <div className="flex items-center justify-center gap-2">
              <ShieldCheck className="w-5 h-5 text-yellow-400" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-yellow-400">AI Suite</span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight rainbow-text">{LEVEL_UP_TITLE}</h2>
            <p className="text-sm text-white/50">{LEVEL_UP_DESCRIPTION}</p>
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
              <h3 className="text-xl font-bold mb-2">Upload Main Visual</h3>
              <p className="text-sm text-white/40 mb-8">Start by uploading your main image, design, product visual, or PDF.</p>
              <button className="px-8 py-3 rounded-full bg-white text-black font-bold uppercase tracking-widest hover:bg-white/90 transition-colors">
                Choose File
              </button>
            </div>
          ) : (
            <div className="w-full max-w-4xl flex flex-col gap-6">
              <div className="relative rounded-3xl overflow-hidden bg-white/5 border border-white/10 min-h-[360px] flex items-center justify-center">
                {showScrollHintOverlay && <ScrollHint overlay />}
                <div ref={previewStageRef} className="relative flex h-full w-full items-center justify-center p-4">
                  <img src={file} alt="LEVEL UP preview" className={cn("max-w-full max-h-[72vh] object-contain", isProcessing && "blur-sm opacity-50")} />
                </div>

                {isProcessing && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/45 backdrop-blur-sm z-20">
                    <Loader2 className="w-12 h-12 text-white animate-spin mb-4" />
                    <p className="text-white font-medium animate-pulse uppercase tracking-widest text-xs">
                      AI is working...
                    </p>
                  </div>
                )}

                <AnimatePresence>
                  {prediction && !isProcessing && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 20 }}
                      className="absolute inset-0 flex items-center justify-center p-6 z-30"
                    >
                      <div className="w-full max-w-md bg-black/90 backdrop-blur-xl border border-white/20 rounded-3xl p-6 shadow-2xl relative flex flex-col max-h-[80%]">
                        <button
                          onClick={() => setPrediction(null)}
                          className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>

                        <div className="overflow-y-auto pr-2 space-y-6 flex-1">
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold uppercase tracking-widest text-white/50">Performance Score</span>
                              <span className="text-2xl font-bold rainbow-text">{prediction.score}%</span>
                            </div>
                            <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                              <motion.div initial={{ width: 0 }} animate={{ width: `${prediction.score}%` }} className="h-full bg-white" />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <h4 className="text-xs font-bold uppercase tracking-widest text-white/50">Detailed Analysis</h4>
                            <p className="text-sm text-white/70 leading-relaxed italic">"{prediction.reasoning}"</p>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <AnimatePresence mode="wait">
                {activeTool === "mockup" && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="w-full max-w-2xl mx-auto space-y-4">
                    <input
                      type="text"
                      placeholder="Describe your mockup (e.g. billboard, packaging, cafe sign...)"
                      value={mockupPrompt}
                      onChange={(event) => setMockupPrompt(event.target.value)}
                      className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-white/30 transition-all"
                    />
                    <button
                      onClick={() => handleProcess("mockup")}
                      className="w-full py-3 rounded-2xl bg-white text-black font-bold uppercase tracking-widest text-[10px]"
                    >
                      Generate Mockup
                    </button>
                  </motion.div>
                )}

                {activeTool === "pro" && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="w-full max-w-2xl mx-auto space-y-4">
                    {renderLogoUploader("Upload Brand Logo (Optional)")}
                    <input
                      type="text"
                      placeholder="Enter headline or brand text"
                      value={proText}
                      onChange={(event) => setProText(event.target.value)}
                      className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-white/30 transition-all"
                    />
                    <button
                      onClick={() => handleProcess("pro")}
                      className="w-full py-3 rounded-2xl bg-white text-black font-bold uppercase tracking-widest text-[10px]"
                    >
                      Brand Photo
                    </button>
                  </motion.div>
                )}

              </AnimatePresence>

              <button
                onClick={() => {
                  reset(null);
                  setPrediction(null);
                  setActiveTool(null);
                  setIsCreateStudioOpen(false);
                  clearBusinessDrafts();
                  setCurrentExportTarget(null);
                }}
                className="self-center flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/30 hover:text-white transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Replace Visual
              </button>
            </div>
          )}
        </div>

        <HistoryDrawer open={showHistory} title="Level Up history" items={historyEntries} currentItem={file} onClose={() => setShowHistory(false)} onSelect={handleHistorySelect} />
      </div>

      <AnimatePresence>
        {isCreateStudioOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black"
          >
            <div className="safe-area-top flex items-center justify-between px-4 py-3 border-b border-white/10 bg-black/92 backdrop-blur-md">
              <button
                type="button"
                onClick={closeCreateStudio}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white transition-colors hover:bg-white/10"
                aria-label="Close CREATE"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="text-center">
                <p className="text-[10px] font-bold tracking-[0.22em] text-white/35">{LEVEL_UP_TITLE}</p>
                <h3 className="text-sm font-bold rainbow-text">CREATE</h3>
              </div>
              <div className="w-10" />
            </div>

            <div className="visible-scrollbar relative h-[calc(100vh-69px)] overflow-y-auto bg-black p-4 pr-2 pb-10">
              <div className="mx-auto max-w-3xl space-y-4">
                {!createUseType ? (
                  <section className="rounded-3xl border border-white/10 bg-white/5 p-4 sm:p-5 space-y-4">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Step 1</p>
                      <h4 className="text-lg font-bold">Choose a category</h4>
                      <p className="text-sm text-white/55">Pick the exact graphic type first. The next page will show the right fields, uploads, and export formats for that choice.</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {CREATE_TYPE_ORDER.map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => selectCreateType(type)}
                          className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left transition-colors hover:bg-white/10"
                        >
                          <p className="text-sm font-bold">{type}</p>
                          <p className="text-xs text-white/50 mt-1">{CREATE_TYPE_CONFIG[type].description}</p>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : (
                  <section className="rounded-3xl border border-white/10 bg-white/5 p-4 sm:p-5 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Step 2</p>
                        <h4 className="text-lg font-bold">{createUseType}</h4>
                        <p className="text-sm text-white/55">{createConfig?.helper}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCreateUseType(null)}
                        className="flex items-center gap-1 px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-[10px] font-bold uppercase tracking-[0.16em] hover:bg-white/10 transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" />
                        Change
                      </button>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Output format</label>
                      <select
                        value={createOutputFormat}
                        onChange={(event) => setCreateOutputFormat(event.target.value)}
                        className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-white/30 transition-all"
                      >
                        {createConfig?.formats.map((format) => (
                          <option key={format.value} value={format.value}>{format.label}</option>
                        ))}
                      </select>
                    </div>

                    {createConfig?.allowLogo && renderLogoUploader("Upload Logo")}

                    {createConfig?.allowImages && (
                      <>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">{createConfig.imagesLabel || "Upload images"}</p>
                          <p className="text-sm text-white/55">{createConfig.imagesHelp}</p>
                        </div>

                        <div
                          {...getCreateAssetsRootProps()}
                          className="w-full p-4 rounded-2xl border-2 border-dashed border-white/10 bg-white/5 text-center cursor-pointer hover:bg-white/10 transition-all"
                        >
                          <input {...getCreateAssetsInputProps()} />
                          <div className="flex items-center justify-center gap-2 text-white/50">
                            <Upload className="w-4 h-4" />
                            <span className="text-[10px] font-bold uppercase tracking-[0.18em]">Upload images</span>
                          </div>
                          <p className="text-[11px] text-white/35 mt-2">
                            {createConfig.minImages ? `Minimum ${createConfig.minImages} image${createConfig.minImages === 1 ? "" : "s"} required.` : "Add optional images or references."}
                          </p>
                        </div>

                        {createReferenceImages.length > 0 && (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {createReferenceImages.map((image, index) => (
                              <div key={`${image}-${index}`} className="relative rounded-2xl overflow-hidden border border-white/10 bg-white/5 aspect-square">
                                <img src={image} alt={`Reference ${index + 1}`} className="w-full h-full object-cover" />
                                <button
                                  type="button"
                                  onClick={() => setCreateReferenceImages((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-black/80 transition-colors"
                                  aria-label={`Remove reference ${index + 1}`}
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {createConfig?.fields.map((field) => (
                        <div key={field.id} className={field.fullWidth ? "sm:col-span-2 space-y-2" : "space-y-2"}>
                          <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">{field.label}</label>
                          {field.type === "textarea" ? (
                            <textarea
                              value={createFormValues[field.id] || ""}
                              onChange={(event) => setCreateFormValues((prev) => ({ ...prev, [field.id]: event.target.value }))}
                              rows={4}
                              placeholder={field.placeholder}
                              className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-white/30 transition-all resize-none"
                            />
                          ) : (
                            <input
                              type={field.type || "text"}
                              value={createFormValues[field.id] || ""}
                              onChange={(event) => setCreateFormValues((prev) => ({ ...prev, [field.id]: event.target.value }))}
                              placeholder={field.placeholder}
                              className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-white/30 transition-all"
                            />
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Additional text</label>
                      <textarea
                        placeholder={createConfig?.additionalTextPlaceholder}
                        value={createAdditionalText}
                        onChange={(event) => setCreateAdditionalText(event.target.value)}
                        rows={3}
                        className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-white/30 transition-all resize-none"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Notes</label>
                      <textarea
                        placeholder={createConfig?.notesPlaceholder}
                        value={createNotes}
                        onChange={(event) => setCreateNotes(event.target.value)}
                        rows={4}
                        className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-white/30 transition-all resize-none"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => handleProcess("create")}
                      disabled={isProcessing}
                      className="w-full py-4 rounded-2xl bg-white text-black font-bold uppercase tracking-[0.2em] hover:bg-white/90 disabled:opacity-30 transition-all flex items-center justify-center gap-2"
                    >
                      {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      <span>Generate Graphic</span>
                    </button>
                  </section>
                )}
              </div>

              {isProcessing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-sm">
                  <div className="flex flex-col items-center gap-3 rounded-3xl border border-white/10 bg-black/80 px-6 py-5 shadow-2xl">
                    <Loader2 className="w-10 h-10 text-white animate-spin" />
                    <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/75">Generating graphic...</p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="safe-area-bottom bg-black border-t border-white/10 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold tracking-widest text-white/30">{LEVEL_UP_TITLE}</span>
        </div>

        <div className="visible-horizontal-scrollbar flex gap-3 overflow-x-auto pb-2">
          {file && (
            <button
              onClick={() => {
                reset(null);
                setPrediction(null);
                setActiveTool(null);
                setIsCreateStudioOpen(false);
                clearBusinessDrafts();
                setCurrentExportTarget(null);
              }}
              className="flex-shrink-0 flex flex-col items-center justify-center gap-2 p-4 rounded-3xl border border-red-500/20 bg-red-500/5 text-red-400 min-w-[100px] hover:bg-red-500/10 transition-all"
            >
              <RotateCcw className="w-6 h-6" />
              <p className="text-[10px] font-bold uppercase leading-none">Replace</p>
            </button>
          )}

          {tools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => handleToolPress(tool.id)}
              className={cn(
                "flex-shrink-0 flex flex-col items-center gap-2 p-4 rounded-3xl border transition-all min-w-[110px]",
                activeTool === tool.id ? "bg-white text-black border-white" : "bg-white/5 border-white/10 text-white hover:bg-white/10",
              )}
            >
              <tool.icon className="w-5 h-5" />
              <div className="text-center">
                <p className="text-[10px] font-bold uppercase leading-none">{tool.label}</p>
                {getToolConfig(UI_TOOL_TO_INTERNAL_ID[tool.id])?.trialEligible ? (
                  <p className={cn("mt-1 text-[7px] font-bold uppercase tracking-[0.16em]", activeTool === tool.id ? "text-black/70" : "text-yellow-300")}>Free trial</p>
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
