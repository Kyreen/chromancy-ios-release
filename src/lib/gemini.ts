import { DesignCriticResult } from "../types";
import { buildApiUrl } from "./api-base";
import { getDeviceId } from "./device";
import { auth } from "./firebase";
import { getAuthHeaderOnly } from "./serverUsage";
import { getToolConfig, getToolPriceCents, getToolPriceZar, getToolProCreditCost } from "./toolConfig";
import { isSubscriberTier } from "./tier";
import { refreshUsageSnapshot } from "./pricing";

export interface AiRequestMeta {
  toolId?: string;
  tier?: string;
  retryOfJobId?: string;
}

export interface BusinessGraphicDesignPlanLayer {
  kind: "text" | "image" | "shape";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  zIndex?: number;
  role?: "headline" | "body" | "panel" | "badge" | "logo" | "photo" | "product" | "decorative" | "frame" | "sticker" | "icon";
  text?: string;
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  letterSpacing?: number;
  textAlign?: "left" | "center" | "right";
  assetRef?: string;
  fit?: "contain" | "cover";
  frameShape?: "rectangle" | "rounded" | "circle";
  borderRadius?: number;
  cropX?: number;
  cropY?: number;
  cropScale?: number;
  shape?: "rect" | "circle" | "line";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  texture?: "none" | "gold_foil" | "silver_metal" | "rose_gold" | "chrome_blue" | "glass" | "silk";
}

export interface BusinessGraphicDesignPlan {
  title: string;
  backgroundColor: string;
  layers: BusinessGraphicDesignPlanLayer[];
}

export interface BusinessGraphicDocumentResponse {
  plan: BusinessGraphicDesignPlan;
  previewImageUrl: string;
}

const FREE_TEST_MODE = import.meta.env.VITE_CHROMANCY_FREE_TEST_MODE === "true";
const MAX_AI_SOURCE_DIMENSION = Number(import.meta.env.VITE_CHROMANCY_AI_SOURCE_MAX_DIMENSION || 1800);
const MAX_AI_SOURCE_BYTES = Number(import.meta.env.VITE_CHROMANCY_AI_SOURCE_MAX_BYTES || 1_800_000);
const AI_CONFIRM_APPROVAL_TTL_MS = 15_000;

const approvedAiSpend = new Map<string, number>();
let activeAiSpendDialog: Promise<boolean> | null = null;
const activeAiControllers = new Set<AbortController>();
const activeAiRequestKeys = new Set<string>();
let aiAbortListenersAttached = false;

function unwrapServerErrorMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed);
    return String(parsed?.error?.message || parsed?.message || trimmed);
  } catch {
    return trimmed;
  }
}

function isVertexRoleErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  return (normalized.includes("valid role") && normalized.includes("user") && normalized.includes("model"))
    || (normalized.includes("invalid_argument") && normalized.includes("role"));
}

async function readError(response: Response) {
  const data = await response.json().catch(() => ({} as { error?: string }));
  const serverMessage = unwrapServerErrorMessage(data?.error);
  const message = serverMessage || `Request failed: ${response.status}`;
  const error = new Error(message);
  (error as any).status = response.status;
  throw error;
}

async function buildAiBody(body: Record<string, unknown>, meta?: AiRequestMeta): Promise<Record<string, unknown>> {
  const tool = getToolConfig(meta?.toolId);
  const expectedPricing = tool?.isAi && tool.pricingTier !== "free"
    ? {
        expectedWalletSpendCents: getToolPriceCents(tool.internalId, !!meta?.retryOfJobId),
        expectedProCreditCost: getToolProCreditCost(tool.internalId, !!meta?.retryOfJobId),
      }
    : {};

  return {
    ...body,
    ...(meta || {}),
    ...expectedPricing,
    uid: auth.currentUser?.uid || null,
    deviceId: getDeviceId(),
  };
}

function formatZarForConfirm(amount: number) {
  return `R${amount.toFixed(Number.isInteger(amount) ? 0 : 2)}`;
}

function createAiCancelledError() {
  const error = new Error("AI generation cancelled.");
  (error as any).cancelled = true;
  return error;
}

function isAbortLikeError(error: unknown) {
  if (!error) return false;
  const name = String((error as any)?.name || "");
  const message = String((error as any)?.message || "");
  return name === "AbortError"
    || message === "AbortError"
    || message === "The operation was aborted."
    || message.includes("aborted");
}

export function cancelActiveAiRequests() {
  activeAiControllers.forEach((controller) => controller.abort());
  activeAiControllers.clear();
}

function ensureAiAbortListeners() {
  if (aiAbortListenersAttached || typeof window === "undefined") return;
  aiAbortListenersAttached = true;

  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      cancelActiveAiRequests();
    }
  };

  window.addEventListener("pagehide", cancelActiveAiRequests, { passive: true });
  window.addEventListener("beforeunload", cancelActiveAiRequests, { passive: true });
  document.addEventListener("visibilitychange", handleVisibilityChange, { passive: true });
}

function getAiSpendApprovalKey(meta?: AiRequestMeta) {
  return [
    auth.currentUser?.uid || "guest",
    meta?.toolId || "unknown",
    meta?.tier || "free",
    meta?.retryOfJobId ? "retry" : "new",
  ].join("::");
}

function getAiRequestLockKey(meta?: AiRequestMeta) {
  return [
    auth.currentUser?.uid || "guest",
    meta?.toolId || "unknown",
    meta?.retryOfJobId ? "retry" : "new",
  ].join("::");
}

function acquireAiRequestLock(meta?: AiRequestMeta) {
  const key = getAiRequestLockKey(meta);
  if (activeAiRequestKeys.has(key)) {
    throw new Error("AI_REQUEST_ALREADY_IN_PROGRESS");
  }
  activeAiRequestKeys.add(key);
  return () => {
    activeAiRequestKeys.delete(key);
  };
}

function rememberAiSpendApproval(meta?: AiRequestMeta) {
  approvedAiSpend.set(getAiSpendApprovalKey(meta), Date.now() + AI_CONFIRM_APPROVAL_TTL_MS);
}

function consumeAiSpendApproval(meta?: AiRequestMeta) {
  const key = getAiSpendApprovalKey(meta);
  const expiry = approvedAiSpend.get(key);
  if (!expiry) return false;
  approvedAiSpend.delete(key);
  return expiry > Date.now();
}

function refreshUsageAfterAi(meta?: AiRequestMeta) {
  const tier = meta?.tier === "premium" ? "premium" : meta?.tier === "pro" ? "pro" : "free";
  void refreshUsageSnapshot(tier).catch(() => undefined);
}

function getAiSpendContext(meta?: AiRequestMeta) {
  const tool = getToolConfig(meta?.toolId);
  if (FREE_TEST_MODE || !tool?.isAi || tool.pricingTier === "free") return null;

  const isSubscriber = isSubscriberTier(meta?.tier === "premium" ? "premium" : meta?.tier === "pro" ? "pro" : "free");
  const creditCost = getToolProCreditCost(tool.internalId, !!meta?.retryOfJobId);
  const priceZar = getToolPriceZar(tool.internalId, !!meta?.retryOfJobId);
  const creditLabel = `${creditCost} AI Subscription Credit${creditCost === 1 ? "" : "s"}`;
  const walletLabel = `${formatZarForConfirm(priceZar)} of wallet funds`;
  const costText = isSubscriber
    ? tool.trialEligible
      ? `If no free trial applies, this will cost ${creditLabel}. If you do not have enough AI Subscription Credits available, it will use ${walletLabel} instead.`
      : `This will cost ${creditLabel}. If you do not have enough AI Subscription Credits available, it will use ${walletLabel} instead.`
    : tool.trialEligible
      ? `If no free trial applies, this will cost ${walletLabel}.`
      : `This will cost ${walletLabel}.`;

  return {
    title: `Use ${tool.displayName}?`,
    message: `${costText} You will be charged before generation starts. If generation fails or no result is produced, the charge is refunded automatically.`,
  };
}

function showAiSpendDialog(title: string, message: string): Promise<boolean> {
  if (activeAiSpendDialog) {
    return activeAiSpendDialog;
  }

  if (typeof document === "undefined" || !document.body) {
    if (typeof window === "undefined" || typeof window.confirm !== "function") {
      return Promise.resolve(true);
    }
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }

  activeAiSpendDialog = new Promise<boolean>((resolve) => {
    const overlay = document.createElement("div");
    const card = document.createElement("div");
    const titleNode = document.createElement("h3");
    const messageNode = document.createElement("p");
    const buttonRow = document.createElement("div");
    const cancelButton = document.createElement("button");
    const confirmButton = document.createElement("button");

    const finish = (confirmed: boolean) => {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      activeAiSpendDialog = null;
      resolve(confirmed);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    };

    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "9999";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.padding = "24px";
    overlay.style.background = "rgba(0, 0, 0, 0.68)";
    overlay.style.backdropFilter = "blur(10px)";

    card.style.width = "min(420px, 100%)";
    card.style.borderRadius = "28px";
    card.style.border = "1px solid rgba(255, 255, 255, 0.12)";
    card.style.background = "linear-gradient(180deg, rgba(18, 18, 20, 0.98), rgba(10, 10, 12, 0.98))";
    card.style.boxShadow = "0 24px 80px rgba(0, 0, 0, 0.45)";
    card.style.padding = "24px";
    card.style.color = "#fff";

    titleNode.textContent = title;
    titleNode.style.margin = "0 0 12px";
    titleNode.style.fontSize = "1.1rem";
    titleNode.style.fontWeight = "700";
    titleNode.style.letterSpacing = "0.01em";

    messageNode.textContent = message;
    messageNode.style.margin = "0";
    messageNode.style.fontSize = "0.95rem";
    messageNode.style.lineHeight = "1.55";
    messageNode.style.color = "rgba(255,255,255,0.78)";

    buttonRow.style.display = "flex";
    buttonRow.style.gap = "12px";
    buttonRow.style.marginTop = "22px";

    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";
    cancelButton.style.flex = "1";
    cancelButton.style.borderRadius = "16px";
    cancelButton.style.border = "1px solid rgba(255,255,255,0.14)";
    cancelButton.style.background = "rgba(255,255,255,0.06)";
    cancelButton.style.color = "#fff";
    cancelButton.style.padding = "14px 16px";
    cancelButton.style.fontSize = "0.95rem";
    cancelButton.style.fontWeight = "600";
    cancelButton.style.cursor = "pointer";

    confirmButton.type = "button";
    confirmButton.textContent = "Yes";
    confirmButton.style.flex = "1";
    confirmButton.style.borderRadius = "16px";
    confirmButton.style.border = "1px solid rgba(255,255,255,0.08)";
    confirmButton.style.background = "#ffffff";
    confirmButton.style.color = "#050505";
    confirmButton.style.padding = "14px 16px";
    confirmButton.style.fontSize = "0.95rem";
    confirmButton.style.fontWeight = "700";
    confirmButton.style.cursor = "pointer";

    cancelButton.onclick = () => finish(false);
    confirmButton.onclick = () => finish(true);
    overlay.onclick = (event) => {
      if (event.target === overlay) {
        finish(false);
      }
    };

    buttonRow.append(cancelButton, confirmButton);
    card.append(titleNode, messageNode, buttonRow);
    overlay.append(card);
    document.body.append(overlay);
    document.addEventListener("keydown", onKeyDown);
    window.setTimeout(() => confirmButton.focus(), 0);
  });

  return activeAiSpendDialog;
}

export function isAiGenerationCancelledError(error: unknown) {
  return Boolean((error as any)?.cancelled) || String((error as any)?.message || "") === "AI generation cancelled.";
}

export async function requestAiSpendConfirmation(meta?: AiRequestMeta) {
  const context = getAiSpendContext(meta);
  if (!context) return true;
  if (consumeAiSpendApproval(meta)) return true;

  const confirmed = await showAiSpendDialog(context.title, context.message);
  if (!confirmed) {
    throw createAiCancelledError();
  }
  rememberAiSpendApproval(meta);
  return true;
}

async function confirmAiSpend(meta?: AiRequestMeta) {
  const context = getAiSpendContext(meta);
  if (!context) return true;
  if (consumeAiSpendApproval(meta)) return true;

  const confirmed = await showAiSpendDialog(context.title, context.message);
  if (!confirmed) {
    throw createAiCancelledError();
  }

  return true;
}

async function postJson<T>(path: string, body: Record<string, unknown>, meta?: AiRequestMeta): Promise<T> {
  await confirmAiSpend(meta);
  const releaseAiRequestLock = acquireAiRequestLock(meta);
  ensureAiAbortListeners();
  const controller = new AbortController();
  activeAiControllers.add(controller);
  let response: Response;
  try {
    response = await fetch(buildApiUrl(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...(FREE_TEST_MODE ? { "X-Chromancy-Free-Test": "1" } : {}),
        ...(await getAuthHeaderOnly()),
      },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify(await buildAiBody({ ...body, spendConfirmed: true }, meta)),
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw createAiCancelledError();
    }
    throw error;
  } finally {
    activeAiControllers.delete(controller);
    releaseAiRequestLock();
  }

  if (!response.ok) {
    await readError(response);
  }

  const data = await response.json() as T;
  refreshUsageAfterAi(meta);
  return data;
}

async function postBinary(path: string, body: Record<string, unknown>, meta?: AiRequestMeta): Promise<Blob> {
  await confirmAiSpend(meta);
  const releaseAiRequestLock = acquireAiRequestLock(meta);
  ensureAiAbortListeners();
  const controller = new AbortController();
  activeAiControllers.add(controller);
  let response: Response;
  try {
    response = await fetch(buildApiUrl(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...(FREE_TEST_MODE ? { "X-Chromancy-Free-Test": "1" } : {}),
        ...(await getAuthHeaderOnly()),
      },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify(await buildAiBody({ ...body, spendConfirmed: true }, meta)),
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw createAiCancelledError();
    }
    throw error;
  } finally {
    activeAiControllers.delete(controller);
    releaseAiRequestLock();
  }

  if (!response.ok) {
    await readError(response);
  }

  const blob = await response.blob();
  refreshUsageAfterAi(meta);
  return blob;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to prepare generated image."));
    reader.readAsDataURL(blob);
  });
}

async function prepareAiImageDataUrl(imageUrl: string): Promise<string> {
  if (!imageUrl.startsWith("data:image/") || MAX_AI_SOURCE_DIMENSION <= 0) return imageUrl;

  const approxBytes = Math.ceil((imageUrl.length * 3) / 4);
  if (approxBytes <= MAX_AI_SOURCE_BYTES) return imageUrl;

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Failed to prepare AI image."));
      element.src = imageUrl;
    });

    const maxSide = Math.max(image.naturalWidth, image.naturalHeight, 1);
    const scale = Math.min(1, MAX_AI_SOURCE_DIMENSION / maxSide);
    if (scale >= 1 && approxBytes <= MAX_AI_SOURCE_BYTES) return imageUrl;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return imageUrl;

    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const outputType = imageUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg";
    return canvas.toDataURL(outputType, outputType === "image/jpeg" ? 0.92 : 0.96);
  } catch {
    return imageUrl;
  }
}

export function isUnsuitableInputError(error: unknown): boolean {
  const status = Number((error as any)?.status || 0);
  if (status && status !== 422) return false;

  const message = String((error as any)?.message || error || "").toLowerCase();
  return [
    "unsuitable",
    "not suited",
    "not suitable",
    "image_not_suited",
    "image_not_suitable",
    "image not suited",
    "image not suitable",
    "no clear subject",
    "no removable area",
    "no face",
    "unable to identify",
    "cannot identify",
    "can't identify",
    "can't detect",
    "cannot detect",
    "no object detected",
    "not enough visual",
  ].some((term) => message.includes(term));
}

export function getAiRequestErrorMessage(error: unknown, fallback = "Processing failed. Please try again.") {
  const status = Number((error as any)?.status || 0);
  const message = unwrapServerErrorMessage(String((error as any)?.message || "").trim()) || "";

  if (isVertexRoleErrorMessage(message)) {
    return "AI service is refreshing its Vertex connection. Please try again in a moment.";
  }

  if (status === 402) {
    return message || "You need AI credits or wallet balance to use this tool.";
  }

  if (status === 429) {
    return message || "Too many AI requests. Please wait a moment before trying again.";
  }

  if (status === 503) {
    return message || "AI is busy or temporarily unavailable. Please wait a moment and try again.";
  }

  if (status === 504) {
    return message || "AI took too long to finish this request. Please try again.";
  }

  if (message === "IMAGE_GENERATION_EMPTY") {
    return "AI did not return a usable result. Please try again with the same image or a clearer request.";
  }

  if (message === "API_KEY_REQUIRED") {
    return "AI service is not ready right now. Please try again in a moment.";
  }

  if ((error as any)?.cancelled || message === "AI generation cancelled.") {
    return "AI generation cancelled.";
  }

  if (message === "AI_REQUEST_ALREADY_IN_PROGRESS") {
    return "This AI generation is already running. Please wait for it to finish.";
  }

  if (status >= 400 && message && !message.toLowerCase().includes("request failed")) {
    return message;
  }

  return fallback;
}

export async function analyzeDesign(imageUrl: string, meta?: AiRequestMeta): Promise<DesignCriticResult> {
  return await postJson<DesignCriticResult>("/api/ai/analyze-design", { imageUrl: await prepareAiImageDataUrl(imageUrl) }, meta);
}

export async function enhancePhoto(
  imageUrl: string,
  instruction: string,
  logoUrl?: string,
  options?: { imageSize?: "1K" | "2K"; promptEditRequest?: string; toolId?: string; tier?: string; retryOfJobId?: string }
): Promise<string> {
  const { toolId, tier, retryOfJobId, ...imageOptions } = options || {};
  const preparedImageUrl = await prepareAiImageDataUrl(imageUrl);
  const preparedLogoUrl = logoUrl ? await prepareAiImageDataUrl(logoUrl) : undefined;
  const blob = await postBinary("/api/ai/enhance-photo", {
    imageUrl: preparedImageUrl,
    instruction,
    logoUrl: preparedLogoUrl,
    options: imageOptions,
  }, { toolId, tier, retryOfJobId });

  return await blobToDataUrl(blob);
}

export async function createBusinessGraphic(input: {
  additionalImageUrls?: string[];
  logoUrl?: string;
  fields: Record<string, string>;
  notes?: string;
  additionalText?: string;
  useType: string;
  outputFormat?: string;
  canvasSize?: { width: number; height: number };
  promptFormat?: string;
  promptDirection?: string;
  transparentBackground?: boolean;
  toolId?: string;
  tier?: string;
  retryOfJobId?: string;
}): Promise<string> {
  const { toolId, tier, retryOfJobId, ...payload } = input;
  const blob = await postBinary("/api/ai/create-business-graphic", {
    ...payload,
    additionalImageUrls: await Promise.all((payload.additionalImageUrls || []).map(prepareAiImageDataUrl)),
    logoUrl: payload.logoUrl ? await prepareAiImageDataUrl(payload.logoUrl) : undefined,
  }, { toolId, tier, retryOfJobId });
  return await blobToDataUrl(blob);
}

export async function planBusinessGraphicDesign(input: {
  additionalImageUrls?: string[];
  logoUrl?: string;
  fields: Record<string, string>;
  notes?: string;
  additionalText?: string;
  useType: string;
  outputFormat?: string;
  canvasSize?: { width: number; height: number };
  promptFormat?: string;
  promptDirection?: string;
  transparentBackground?: boolean;
  toolId?: string;
  tier?: string;
  retryOfJobId?: string;
}): Promise<BusinessGraphicDesignPlan> {
  const { toolId, tier, retryOfJobId, ...payload } = input;
  return await postJson<BusinessGraphicDesignPlan>("/api/ai/plan-business-graphic-design", {
    ...payload,
    additionalImageUrls: await Promise.all((payload.additionalImageUrls || []).map(prepareAiImageDataUrl)),
    logoUrl: payload.logoUrl ? await prepareAiImageDataUrl(payload.logoUrl) : undefined,
  }, { toolId, tier, retryOfJobId });
}

export async function createBusinessGraphicDocument(input: {
  additionalImageUrls?: string[];
  logoUrl?: string;
  fields: Record<string, string>;
  notes?: string;
  additionalText?: string;
  useType: string;
  outputFormat?: string;
  canvasSize?: { width: number; height: number };
  promptFormat?: string;
  promptDirection?: string;
  transparentBackground?: boolean;
  toolId?: string;
  tier?: string;
  retryOfJobId?: string;
}): Promise<BusinessGraphicDocumentResponse> {
  const { toolId, tier, retryOfJobId, ...payload } = input;
  return await postJson<BusinessGraphicDocumentResponse>("/api/ai/create-business-graphic-document", {
    ...payload,
    additionalImageUrls: await Promise.all((payload.additionalImageUrls || []).map(prepareAiImageDataUrl)),
    logoUrl: payload.logoUrl ? await prepareAiImageDataUrl(payload.logoUrl) : undefined,
  }, { toolId, tier, retryOfJobId });
}

export async function removeObject(imageUrl: string, maskUrl: string, instruction: string, meta?: AiRequestMeta): Promise<string> {
  const blob = await postBinary("/api/ai/remove-object", {
    imageUrl: await prepareAiImageDataUrl(imageUrl),
    maskUrl: await prepareAiImageDataUrl(maskUrl),
    instruction,
  }, meta);

  return await blobToDataUrl(blob);
}

export async function generateVideo(imageUrl: string, prompt: string, meta?: AiRequestMeta): Promise<string> {
  const blob = await postBinary("/api/ai/generate-video", { imageUrl: await prepareAiImageDataUrl(imageUrl), prompt }, meta);
  return URL.createObjectURL(blob);
}

export async function settleLocalAiFallback(meta?: AiRequestMeta): Promise<void> {
  if (!meta?.toolId) return;

  ensureAiAbortListeners();
  const controller = new AbortController();
  activeAiControllers.add(controller);
  try {
    const response = await fetch(buildApiUrl("/api/ai/settle-local-fallback"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...(FREE_TEST_MODE ? { "X-Chromancy-Free-Test": "1" } : {}),
        ...(await getAuthHeaderOnly()),
      },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify(await buildAiBody({ spendConfirmed: true }, meta)),
    });

    if (!response.ok) {
      await readError(response);
    }

    refreshUsageAfterAi(meta);
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw createAiCancelledError();
    }
    throw error;
  } finally {
    activeAiControllers.delete(controller);
  }
}

export async function posePerfect(imageUrl: string, instruction: string, meta?: AiRequestMeta): Promise<string> {
  const blob = await postBinary("/api/ai/pose-perfect", { imageUrl: await prepareAiImageDataUrl(imageUrl), instruction }, meta);
  return await blobToDataUrl(blob);
}

export async function predictPerformance(imageUrl: string, meta?: AiRequestMeta): Promise<{ score: number; reasoning: string }> {
  return await postJson<{ score: number; reasoning: string }>("/api/ai/predict-performance", { imageUrl: await prepareAiImageDataUrl(imageUrl) }, meta);
}
