import { GoogleGenAI, Type } from "@google/genai";
import { GoogleAuth } from "google-auth-library";

export interface ServerDesignCriticResult {
  score: number;
  hierarchy: string;
  contrast: string;
  balance: string;
  suggestions: string[];
}

export interface ServerPerformancePrediction {
  score: number;
  reasoning: string;
}

export interface ServerDesignStudioExtractionElement {
  kind: "text" | "image" | "shape";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  zIndex?: number;
  text?: string;
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  letterSpacing?: number;
  textAlign?: "left" | "center" | "right";
  role?: "logo" | "photo" | "product" | "decorative" | "panel" | "badge" | "headline" | "body";
  fit?: "contain" | "cover";
  borderRadius?: number;
  shape?: "rect" | "circle";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  removeFromBackground?: boolean;
}

export interface ServerDesignStudioExtractionResult {
  elements: ServerDesignStudioExtractionElement[];
}

export interface ServerBusinessGraphicInput {
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
}

export interface ServerBusinessGraphicPlanLayer {
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

export interface ServerBusinessGraphicPlan {
  title: string;
  backgroundColor: string;
  layers: ServerBusinessGraphicPlanLayer[];
}

export interface ServerVideoResult {
  buffer: Buffer;
  mimeType: string;
}

interface ServerAnimatePlan {
  normalizedPrompt: string;
  contentType: string;
  primarySubject: string;
  motionStrategy: string;
  secondaryMotion: string[];
  keepStable: string[];
  avoid: string[];
  preferCameraOnly: boolean;
}

interface ServerPromptEditPlan {
  normalizedRequest: string;
  requestedOutcome: string;
  editScope: string;
  localizedTarget: string;
  targetArea: string;
  backgroundChangeAllowed: boolean;
  keepExactly: string[];
  forbiddenChanges: string[];
  executionNotes: string[];
  touchesProtectedIdentity: boolean;
}

const DIRECT_GEMINI_PROVIDER_VALUES = new Set(["gemini", "google_ai", "api_key", "ml_dev", "developer", "false", "0", "no"]);

function getAiProvider(): string {
  return String(process.env.CHROMANCY_AI_PROVIDER || process.env.GOOGLE_GENAI_USE_VERTEXAI || "vertex")
    .trim()
    .toLowerCase();
}

function useVertexAI(): boolean {
  return !DIRECT_GEMINI_PROVIDER_VALUES.has(getAiProvider());
}

function getVertexProject(): string {
  return String(
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.VERTEX_AI_PROJECT ||
    process.env.GOOGLE_PROJECT_ID ||
    "",
  ).trim();
}

function getVertexLocation(): string {
  return String(
    process.env.GOOGLE_CLOUD_LOCATION ||
    process.env.VERTEX_AI_LOCATION ||
    process.env.GOOGLE_CLOUD_REGION ||
    "global",
  ).trim();
}

export function isAiConfigured(): boolean {
  return useVertexAI()
    ? Boolean(getVertexProject())
    : Boolean(String(process.env.GEMINI_API_KEY || "").trim());
}

function isAiProviderConfigError(error: unknown): boolean {
  const message = String((error as any)?.message || error || "");
  return message.includes("API_KEY_REQUIRED")
    || message.includes("VERTEX_AI_CONFIG_REQUIRED")
    || message.includes("VERTEX_AI_AUTH_REQUIRED");
}

function getAiErrorText(error: unknown): string {
  const direct = String((error as any)?.message || error || "");
  let serialized = "";
  try {
    serialized = JSON.stringify(error || {});
  } catch {
    serialized = "";
  }
  return `${direct} ${serialized}`;
}

function isVertexRoleRequestError(error: unknown): boolean {
  const message = getAiErrorText(error).toLowerCase();
  return (message.includes("valid role") && message.includes("user") && message.includes("model"))
    || (message.includes("invalid_argument") && message.includes("role"));
}

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY || "";
  if (!key.trim()) {
    throw new Error("API_KEY_REQUIRED");
  }
  return key;
}

function getAI() {
  if (useVertexAI()) {
    const project = getVertexProject();
    if (!project) {
      throw new Error("VERTEX_AI_CONFIG_REQUIRED");
    }

    return new GoogleGenAI({
      vertexai: true,
      project,
      location: getVertexLocation(),
    });
  }

  return new GoogleGenAI({ vertexai: false, apiKey: getApiKey() });
}

let vertexAuth: GoogleAuth | null = null;

async function getVertexAccessToken(): Promise<string> {
  if (!vertexAuth) {
    vertexAuth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  }

  const client = await vertexAuth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;
  if (!token) {
    throw new Error("VERTEX_AI_AUTH_REQUIRED");
  }
  return token;
}

async function getVideoDownloadHeaders(): Promise<Record<string, string>> {
  if (useVertexAI()) {
    return {
      Authorization: `Bearer ${await getVertexAccessToken()}`,
    };
  }

  return {
    "x-goog-api-key": getApiKey(),
  };
}

const AI_MODEL_TIMEOUT_MS = Math.max(15_000, Number(process.env.CHROMANCY_AI_MODEL_TIMEOUT_MS || 90_000));
const AI_VIDEO_TIMEOUT_MS = Math.max(AI_MODEL_TIMEOUT_MS, Number(process.env.CHROMANCY_AI_VIDEO_TIMEOUT_MS || 360_000));
const AI_VIDEO_POLL_INTERVAL_MS = Math.max(1_500, Number(process.env.CHROMANCY_AI_VIDEO_POLL_INTERVAL_MS || 2_000));

function getDefaultImageSize(): "1K" | "2K" {
  return process.env.CHROMANCY_AI_IMAGE_SIZE === "2K" ? "2K" : "1K";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function parseDataUrl(dataUrl: string) {
  if (!dataUrl || !dataUrl.startsWith("data:")) {
    throw new Error("Invalid image data");
  }

  const [meta, base64Data] = dataUrl.split(",");
  if (!meta || !base64Data) {
    throw new Error("Invalid image data");
  }

  const mimeType = meta.split(":")[1]?.split(";")[0];
  if (!mimeType) {
    throw new Error("Invalid image MIME type");
  }

  return { base64Data, mimeType };
}

function buildInlineImagePart(dataUrl: string) {
  const { base64Data, mimeType } = parseDataUrl(dataUrl);
  return {
    inlineData: {
      data: base64Data,
      mimeType,
    },
  };
}

function buildUserContents(parts: any[]) {
  return [
    {
      role: "user",
      parts,
    },
  ] as any;
}

function getResponseText(response: any): string {
  if (typeof response?.text === "string" && response.text.trim()) {
    return response.text;
  }

  return (response?.candidates || [])
    .flatMap((candidate: any) => candidate?.content?.parts || [])
    .map((part: any) => part?.text || "")
    .join(" ")
    .trim();
}

export function isUnsuitableInputError(error: unknown): boolean {
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

function isExplicitUnsuitableInputResponse(responseText: string): boolean {
  const message = responseText.toLowerCase();
  return [
    "no usable visual content",
    "no usable image content",
    "no clear face",
    "no face detected",
    "no person detected",
    "no removable object",
    "no removable area",
    "cannot detect a subject",
    "cannot identify a subject",
    "not suitable for this tool",
    "not suited for this tool",
  ].some((term) => message.includes(term));
}

function extractGeneratedImageBuffer(response: any): Buffer {
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData?.data) {
      return Buffer.from(part.inlineData.data, "base64");
    }
  }

  const responseText = getResponseText(response);
  if (isExplicitUnsuitableInputResponse(responseText)) {
    throw new Error("IMAGE_NOT_SUITABLE_FOR_TOOL");
  }

  throw new Error("IMAGE_GENERATION_EMPTY");
}

function isTransientAiError(error: any): boolean {
  const message = String(error?.message || error || "").toLowerCase();
  const status = error?.status || error?.code || error?.error?.code || error?.error?.status;

  return status === 500
    || status === 502
    || status === 503
    || status === 504
    || message.includes("internal")
    || message.includes("unavailable")
    || message.includes("timeout")
    || message.includes("timed out")
    || message.includes("deadline")
    || message.includes("fetch failed")
    || message.includes("network")
    || message.includes("econnreset")
    || message.includes("socket hang up")
    || message.includes("temporar")
    || message.includes("ai_request_timeout")
    || message.includes("ai_video_timeout")
    || message.includes("image_generation_empty");
}

function normalizePromptText(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function normalizePromptList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .map((item) => normalizePromptText(item))
    .filter(Boolean)
    .slice(0, 8);
  return normalized.length ? normalized : fallback;
}

function requestExplicitlyChangesBackground(normalizedRequest: string): boolean {
  return [
    /\b(change|replace|swap|remove|blur|restyle|recolor|regenerate|redo|make|turn|set)(?: the| my| this| our| a| an)? (background|backdrop|sky|wall|walls|room|scene|scenery|surroundings)\b/i,
    /\b(background|backdrop|sky|wall|walls|room|scene|scenery|surroundings)(?: should| needs to| must| to| into| with| become| be)\b/i,
    /\b(new|different) background\b/i,
    /\btransparent background\b/i,
    /\bbackground blur\b/i,
    /\bblur the background\b/i,
    /\bremove bg\b/i,
  ].some((pattern) => pattern.test(normalizedRequest));
}

function inferPromptEditScope(normalizedRequest: string, backgroundChangeAllowed: boolean): string {
  if (backgroundChangeAllowed) return "background_only";
  if (/\b(entire|whole|overall|full)\s+(photo|image|picture|visual|scene)\b/i.test(normalizedRequest)) {
    return "scene_wide";
  }
  return "localized_target";
}

function inferLocalizedTarget(normalizedRequest: string, editScope: string): string {
  if (editScope === "background_only") {
    return "the background only";
  }
  if (/\b(clothing|clothes|shirt|top|dress|jacket|pants|trousers|skirt|sleeve|outfit|uniform)\b/i.test(normalizedRequest)) {
    return "the clothing area the user described";
  }
  if (/\b(hair|face|skin|eyes|eye|lips|lip|nose|teeth|smile|beard|mustache|body|waist|hips|boobs|breasts|chest|arms|legs|hands)\b/i.test(normalizedRequest)) {
    return "the exact body or identity-related area the user described";
  }
  if (/\b(car|vehicle|wheel|wheels|tyre|tyres|tire|tires|rim|rims|door|hood|bonnet|spoiler|bumper|mirror)\b/i.test(normalizedRequest)) {
    return "the exact vehicle part or car area the user described";
  }
  if (/\b(text|word|words|lettering|logo|sign|label)\b/i.test(normalizedRequest)) {
    return "the exact text or logo region the user described";
  }
  return "only the exact subject, object, accessory, or local image region directly referenced by the user";
}

function createFallbackPromptEditPlan(rawRequest: string): ServerPromptEditPlan {
  const normalizedRequest = normalizePromptText(rawRequest) || "Apply only the small photo change the user asked for.";
  const backgroundChangeAllowed = requestExplicitlyChangesBackground(normalizedRequest);
  const editScope = inferPromptEditScope(normalizedRequest, backgroundChangeAllowed);
  return {
    normalizedRequest,
    requestedOutcome: normalizedRequest,
    editScope,
    localizedTarget: inferLocalizedTarget(normalizedRequest, editScope),
    targetArea: "Only the smallest clearly relevant area mentioned by the user request.",
    backgroundChangeAllowed,
    keepExactly: [
      "Keep the main subject identity, face, body, and composition exactly the same.",
      "Keep the original background, scenery, sky, room, walls, floor, and all unrelated regions visually unchanged unless the user explicitly asked to change the background itself.",
      "Keep all unrelated objects, text, logos, products, and scene content unchanged.",
    ],
    forbiddenChanges: [
      "Do not broaden the request beyond what the user explicitly asked for.",
      "Do not replace, repaint, recolor, blur, regenerate, remove, or restyle the background unless the user explicitly asked for a background change.",
      "Do not change faces, identities, body shape, framing, or unrelated objects unless the user directly requested that exact protected area.",
    ],
    executionNotes: [
      "Use a localized premium edit with clean edges and realistic finishing.",
      "Apply the change only to the requested target and keep the rest of the photo visually stable.",
      "If the request is ambiguous, choose the safest narrow interpretation and preserve the original scene.",
    ],
    touchesProtectedIdentity: /(face|hair|eye|eyes|nose|lip|lips|mouth|smile|skin|teeth|body|hand|hands|person|subject|model|portrait|selfie)/i.test(normalizedRequest),
  };
}

function buildPromptEditPlanInstructions(plan: ServerPromptEditPlan) {
  return [
    "PROMPT EDIT EXECUTION PLAN:",
    `- Exact user request: ${plan.normalizedRequest}`,
    `- Requested outcome: ${plan.requestedOutcome}`,
    `- Edit scope: ${plan.editScope}`,
    `- Exact localized target: ${plan.localizedTarget}`,
    `- Target area: ${plan.targetArea}`,
    `- Background change allowed: ${plan.backgroundChangeAllowed ? "yes" : "no"}`,
    `- Keep exactly: ${plan.keepExactly.join(" | ")}`,
    `- Forbidden changes: ${plan.forbiddenChanges.join(" | ")}`,
    `- Execution notes: ${plan.executionNotes.join(" | ")}`,
    `- Protected identity area involved: ${plan.touchesProtectedIdentity ? "yes" : "no"}`,
  ].join("\n");
}

function createFallbackAnimatePlan(rawPrompt: string): ServerAnimatePlan {
  const normalizedPrompt = normalizePromptText(rawPrompt) || "Create a premium animated result from this still image.";
  return {
    normalizedPrompt,
    contentType: "generic still image",
    primarySubject: "the most visually important subject in the uploaded image",
    motionStrategy: "Use the strongest believable premium motion for the detected content. Lead with clear primary-subject motion whenever possible. If direct subject motion is weak, combine it with visible cinematic camera drift, layered parallax, light movement, or environmental motion so the result unmistakably animates without distorting the image.",
    secondaryMotion: [
      "Motion must be clearly visible early in the clip and must not feel like a frozen still.",
      "Add only tasteful support motion that fits the content type and reinforces the main movement.",
      "Prefer a clearly animated premium result over a static near-still output.",
    ],
    keepStable: [
      "Keep identity, framing, composition, text, and important geometry stable.",
      "Keep subject edges, facial structure, products, and unrelated regions calm and artifact-free.",
    ],
    avoid: [
      "Avoid whole-frame wobble, morphing, duplicate limbs, warped faces, broken text, and rubbery motion.",
      "Do not output a barely-moving clip that still reads like a static image.",
      "Do not refuse a usable still image just because it has no face or limited natural motion.",
    ],
    preferCameraOnly: false,
  };
}

function buildAnimatePromptVariants(plan: ServerAnimatePlan) {
  const normalizedPrompt = normalizePromptText(plan.normalizedPrompt);
  const secondaryMotion = plan.secondaryMotion.join(" | ");
  const keepStable = plan.keepStable.join(" | ");
  const avoid = plan.avoid.join(" | ");

  return Array.from(new Set([
    `Create one short premium professional motion clip from this single still photo. Inspect the uploaded image carefully and animate it visibly, clearly, and confidently.
Content type: ${plan.contentType}.
Primary subject: ${plan.primarySubject}.
Primary motion strategy: ${plan.motionStrategy}
Secondary motion ideas: ${secondaryMotion}
Keep stable: ${keepStable}
Avoid: ${avoid}
The finished clip must show unmistakable motion from the first second and must never feel like a static photo.
If direct subject motion is limited, DO NOT return a near-static still. Instead, use premium cinematic camera drift, depth parallax, restrained light movement, atmospheric motion, or elegant environmental motion so the result clearly animates while preserving the exact scene.
User intent: ${normalizedPrompt}`,
    `Fallback motion strategy: animate this still image with the safest believable premium motion for the detected content type. Use the described primary subject and motion strategy, keep the composition stable, preserve all faces, products, text, and objects exactly, and favor a visibly animated premium result over refusal or a near-static output.
Content type: ${plan.contentType}.
Primary subject: ${plan.primarySubject}.
Motion: ${plan.motionStrategy}
The clip must visibly animate and should feel alive, premium, and intentional. User intent: ${normalizedPrompt}`,
    `Minimal fallback: create a polished premium animation from this still image using clearly visible motion. If natural subject motion is weak, use camera push-in, parallax, light sweep, atmospheric drift, highlight motion, or controlled scene movement instead of refusing. Preserve ${plan.primarySubject} and the original scene integrity exactly. ${normalizedPrompt}`,
    `Emergency usable-result fallback: produce one clean premium living-photo clip from this still image. Never leave it looking static. If necessary, use elegant but noticeable camera motion, restrained parallax, moving highlights, environmental drift, or layered depth motion while keeping faces, bodies, products, vehicles, text, and layout stable. ${normalizedPrompt}`,
  ]));
}

async function planPromptEditRequest(rawRequest: string, imageUrl?: string): Promise<ServerPromptEditPlan> {
  const fallback = createFallbackPromptEditPlan(rawRequest);
  const normalizedRequest = fallback.normalizedRequest;
  if (!normalizedRequest) return fallback;

  try {
    const ai = getAI();
    const plannerParts: any[] = [];
    if (imageUrl) {
      plannerParts.push(buildInlineImagePart(imageUrl));
    }
    plannerParts.push(
      {
        text: `You are a precise premium photo edit planner for Chromancy.

Convert the user's request into a narrow, localized, premium edit plan.

Rules:
- Inspect the uploaded photo first, then understand exactly what the user wants to change.
- Use the image to determine what region the user is most likely referring to.
- Do not broaden the request.
- Unless the user explicitly asks to change, replace, blur, remove, or restyle the background itself, set backgroundChangeAllowed to false.
- If the request mentions something being in the background, that does NOT authorize changing the background. That still counts as a localized edit.
- Preserve the main subject, identity, composition, crop, unrelated objects, and text unless the user explicitly asked to change them.
- If the user explicitly asks to change a protected identity area such as hair, skin, smile, body contour, body size, clothing fit, or a facial detail, allow that exact requested change while keeping the same person recognisable and realistic.
- If the user asks for a complex object or asset change such as adding vehicle parts, replacing accessories, changing clothing details, modifying products, or inserting new visual items, plan that edit precisely and keep it localized.
- Distinguish background-only, subject-only, object-only, text-only, vehicle-only, clothing-only, and body-region-only edits correctly.
- For clothing, body-region, object, accessory, product, vehicle, face-detail, and text requests, set editScope to localized_target and describe the specific target precisely.
- Prefer the smallest effective target area.
- Return concise practical execution instructions for an image editor.
- Do not refuse. Produce the best safe plan for the request.

User request:
${normalizedRequest}`,
      },
    );
    const response = await withRetry(() =>
      ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: buildUserContents(plannerParts),
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              normalizedRequest: { type: Type.STRING },
              requestedOutcome: { type: Type.STRING },
              editScope: { type: Type.STRING },
              localizedTarget: { type: Type.STRING },
              targetArea: { type: Type.STRING },
              backgroundChangeAllowed: { type: Type.BOOLEAN },
              keepExactly: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              forbiddenChanges: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              executionNotes: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              touchesProtectedIdentity: { type: Type.BOOLEAN },
            },
            required: [
              "normalizedRequest",
              "requestedOutcome",
              "editScope",
              "localizedTarget",
              "targetArea",
              "backgroundChangeAllowed",
              "keepExactly",
              "forbiddenChanges",
              "executionNotes",
              "touchesProtectedIdentity",
            ],
          },
        },
      }),
    );

    const parsed = JSON.parse(response.text || "{}");
    return {
      normalizedRequest: normalizePromptText(parsed.normalizedRequest || fallback.normalizedRequest) || fallback.normalizedRequest,
      requestedOutcome: normalizePromptText(parsed.requestedOutcome || fallback.requestedOutcome) || fallback.requestedOutcome,
      editScope: normalizePromptText(parsed.editScope || fallback.editScope) || fallback.editScope,
      localizedTarget: normalizePromptText(parsed.localizedTarget || fallback.localizedTarget) || fallback.localizedTarget,
      targetArea: normalizePromptText(parsed.targetArea || fallback.targetArea) || fallback.targetArea,
      backgroundChangeAllowed: Boolean(
        parsed.backgroundChangeAllowed
        ?? fallback.backgroundChangeAllowed
      ),
      keepExactly: normalizePromptList(parsed.keepExactly, fallback.keepExactly),
      forbiddenChanges: normalizePromptList(parsed.forbiddenChanges, fallback.forbiddenChanges),
      executionNotes: normalizePromptList(parsed.executionNotes, fallback.executionNotes),
      touchesProtectedIdentity: Boolean(
        parsed.touchesProtectedIdentity
        ?? fallback.touchesProtectedIdentity
      ),
    };
  } catch (error) {
    console.warn("Prompt edit planner fell back to the safe local plan.", error);
    return fallback;
  }
}

async function planAnimateRequest(imageUrl: string, rawPrompt: string): Promise<ServerAnimatePlan> {
  const fallback = createFallbackAnimatePlan(rawPrompt);

  try {
    const ai = getAI();
    const response = await withRetry(() =>
      ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: buildUserContents([
          buildInlineImagePart(imageUrl),
          {
            text: `You are a premium image-to-video motion planner for Chromancy.

Inspect the uploaded still image and produce the strongest clean motion plan for animating it.

Rules:
- Correctly classify the content type.
- Identify the true primary subject.
- Choose the most believable motion strategy for this exact image.
- Never reject a usable image just because there is no face or no obvious body motion.
- If the image is static, product-focused, vehicle-focused, poster-like, document-like, graphic, or architectural, prefer premium camera drift, controlled parallax, tasteful light motion, atmospheric movement, or highlight motion so the clip still visibly animates.
- If the image contains a person, pet, or living subject, prefer realistic micro-motion first, then add restrained camera movement only if it helps.
- The final clip must look animated immediately, not like a still frame with tiny accidental movement.
- For people or pets, prefer believable blink, breathing, posture life, hair or clothing sway, and subtle head or hand micro-motion when appropriate.
- For products, food, cars, interiors, posters, or static scenes, prefer strong but elegant camera drift, layered parallax, moving reflections, light sweeps, atmosphere, depth motion, or environmental movement that keeps the image premium and stable.
- Preserve identity, text, object geometry, composition, and important scene integrity exactly.
- Avoid morphing, wobble, duplicate limbs, rubbery motion, broken text, warped wheels, or drifting facial features.
- Produce a motion plan that helps the downstream video model succeed, not a refusal.

User intent:
${fallback.normalizedPrompt}`,
          },
        ]),
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              normalizedPrompt: { type: Type.STRING },
              contentType: { type: Type.STRING },
              primarySubject: { type: Type.STRING },
              motionStrategy: { type: Type.STRING },
              secondaryMotion: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              keepStable: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              avoid: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              preferCameraOnly: { type: Type.BOOLEAN },
            },
            required: [
              "normalizedPrompt",
              "contentType",
              "primarySubject",
              "motionStrategy",
              "secondaryMotion",
              "keepStable",
              "avoid",
              "preferCameraOnly",
            ],
          },
        },
      }),
    );

    const parsed = JSON.parse(response.text || "{}");
    return {
      normalizedPrompt: normalizePromptText(parsed.normalizedPrompt || fallback.normalizedPrompt) || fallback.normalizedPrompt,
      contentType: normalizePromptText(parsed.contentType || fallback.contentType) || fallback.contentType,
      primarySubject: normalizePromptText(parsed.primarySubject || fallback.primarySubject) || fallback.primarySubject,
      motionStrategy: normalizePromptText(parsed.motionStrategy || fallback.motionStrategy) || fallback.motionStrategy,
      secondaryMotion: normalizePromptList(parsed.secondaryMotion, fallback.secondaryMotion),
      keepStable: normalizePromptList(parsed.keepStable, fallback.keepStable),
      avoid: normalizePromptList(parsed.avoid, fallback.avoid),
      preferCameraOnly: Boolean(parsed.preferCameraOnly),
    };
  } catch (error) {
    console.warn("Animate planner fallback engaged", error);
    return fallback;
  }
}

function buildVisibleTextAllowlist(input: ServerBusinessGraphicInput) {
  const values = [
    ...Object.values(input.fields || {}),
    input.additionalText,
  ]
    .map(normalizePromptText)
    .filter(Boolean);

  return Array.from(new Set(values));
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2, delay = 250): Promise<T> {
  try {
    return await withTimeout(fn(), AI_MODEL_TIMEOUT_MS, "AI_REQUEST_TIMEOUT");
  } catch (error: any) {
    let errorString = "";
    try {
      errorString = JSON.stringify(error || {});
    } catch {
      errorString = String(error?.message || error || "");
    }
    const message = error?.message || "";

    const isRateLimit =
      error?.status === "RESOURCE_EXHAUSTED" ||
      error?.code === 429 ||
      error?.error?.code === 429 ||
      error?.error?.status === "RESOURCE_EXHAUSTED" ||
      errorString.includes("429") ||
      errorString.includes("RESOURCE_EXHAUSTED");

    const isPermissionError =
      error?.status === "PERMISSION_DENIED" ||
      error?.code === 403 ||
      message.includes("PERMISSION_DENIED") ||
      message.includes("Requested entity was not found") ||
      message.includes("API key not valid") ||
      message.includes("API_KEY_INVALID") ||
      isAiProviderConfigError(error);

    if (isVertexRoleRequestError(error)) {
      throw new Error("VERTEX_AI_REQUEST_ROLE_INVALID");
    }

    if (isPermissionError) {
      throw new Error(useVertexAI() ? "VERTEX_AI_AUTH_REQUIRED" : "API_KEY_REQUIRED");
    }

    if (retries > 0 && (isRateLimit || isTransientAiError(error))) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }

    throw error;
  }
}

async function generateImageWithRecovery(
  ai: GoogleGenAI,
  input: {
    model: string;
    parts: any[];
    imageSize?: "1K" | "2K";
    recoveryText: string;
  }
): Promise<Buffer> {
  const run = async (parts: any[], imageSize: "1K" | "2K") => {
    const response = await withRetry(() =>
      ai.models.generateContent({
        model: input.model,
        contents: buildUserContents(parts),
        config: {
          imageConfig: {
            imageSize,
          },
        },
      })
    );

    return extractGeneratedImageBuffer(response);
  };

  const primarySize = input.imageSize || getDefaultImageSize();

  try {
    return await run(input.parts, primarySize);
  } catch (error: any) {
    if (isAiProviderConfigError(error) || isUnsuitableInputError(error)) {
      throw error;
    }

    return await run(
      [
        ...input.parts,
        {
          text: `RECOVERY MODE: ${input.recoveryText}`,
        },
      ],
      primarySize === "2K" ? "1K" : primarySize,
    );
  }
}

export async function analyzeDesign(imageUrl: string): Promise<ServerDesignCriticResult> {
  const model = "gemini-3.1-pro-preview";
  const ai = getAI();
  const { base64Data, mimeType } = parseDataUrl(imageUrl);

  const response = await withRetry(() =>
    ai.models.generateContent({
      model,
      contents: buildUserContents(
        [
          {
            text: "You are a design critic. Analyze this design for hierarchy, contrast, balance, clutter, alignment, spacing, readability, overcrowding, focal point, and composition. Provide specific suggestions and a score from 0-100. Respond in JSON format.",
          },
          {
            inlineData: {
              data: base64Data,
              mimeType,
            },
          },
        ],
      ),
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER },
            hierarchy: { type: Type.STRING },
            contrast: { type: Type.STRING },
            balance: { type: Type.STRING },
            suggestions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ["score", "hierarchy", "contrast", "balance", "suggestions"],
        },
      },
    })
  );

  return JSON.parse(response.text || "{}");
}

export async function extractDesignStudioElements(
  imageUrl: string,
  hint?: { toolId?: string; promptContext?: string },
): Promise<ServerDesignStudioExtractionResult> {
  const model = "gemini-3.1-pro-preview";
  const ai = getAI();
  const { base64Data, mimeType } = parseDataUrl(imageUrl);
  const promptContext = String(hint?.promptContext || "").trim();
  const response = await withRetry(() =>
    ai.models.generateContent({
      model,
      contents: buildUserContents([
        {
          text: `You are extracting editable design layers from a flattened design image for a drag-and-drop editor.

Your job:
- Detect the visible movable design elements in this flattened design.
- Separate only the real editable foreground elements such as text blocks, logos, placed photos, product shots, badges, buttons, panels, ribbons, cards, and other deliberate overlay elements.
- Do NOT output the full-page background as a layer.
- Do NOT invent new elements that are not visible.
- For text, read the exact visible text as accurately as possible.
- Detect every visible line of text, including small pricing text, body copy, contact details, dates, times, URLs, and captions. Do not skip smaller text just because it is less prominent.
- If the extra hints contain exact structured content, treat those supplied words as the source of truth when OCR is ambiguous or stylized.
- For text, choose the closest font family from this list only: Poppins, Montserrat, Playfair Display, DM Sans, Bebas Neue, Oswald, Cormorant Garamond, Merriweather, Raleway, Abril Fatface.
- Return positions and sizes as normalized decimal values from 0 to 1.
- Keep boxes tight but not clipped.
- Use zIndex so higher numbers are visually above lower numbers.
- If a layer should be removed from the background to make editing easier, set removeFromBackground to true.
- Prefer separate smaller layers over one giant flattened layer.
- If the design contains an inserted photo region, product image, logo, or decorative cutout that can be moved separately, return it as an image layer.
- For image and logo layers, return the full visible frame or mask boundary, not just the internal subject pixels. If a photo is inside a circle, rounded card, badge, or other frame, the returned box must cover the whole frame cleanly.
- If the design contains a solid or semi-transparent panel, badge, shape, or banner, return it as a shape layer.
- If a text or logo sits on top of another panel, return both as separate layers.
- If you are unsure, still return the best practical editable layer breakdown instead of collapsing everything into one flat result.

Context:
- Tool: ${hint?.toolId || "unknown"}
- Extra hints: ${promptContext || "None"}
`,
        },
        {
          inlineData: {
            data: base64Data,
            mimeType,
          },
        },
      ]),
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            elements: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  kind: { type: Type.STRING, enum: ["text", "image", "shape"] },
                  name: { type: Type.STRING },
                  x: { type: Type.NUMBER },
                  y: { type: Type.NUMBER },
                  width: { type: Type.NUMBER },
                  height: { type: Type.NUMBER },
                  rotation: { type: Type.NUMBER },
                  opacity: { type: Type.NUMBER },
                  zIndex: { type: Type.NUMBER },
                  text: { type: Type.STRING },
                  color: { type: Type.STRING },
                  fontFamily: { type: Type.STRING },
                  fontSize: { type: Type.NUMBER },
                  fontWeight: { type: Type.NUMBER },
                  letterSpacing: { type: Type.NUMBER },
                  textAlign: { type: Type.STRING, enum: ["left", "center", "right"] },
                  role: {
                    type: Type.STRING,
                    enum: ["logo", "photo", "product", "decorative", "panel", "badge", "headline", "body"],
                  },
                  fit: { type: Type.STRING, enum: ["contain", "cover"] },
                  borderRadius: { type: Type.NUMBER },
                  shape: { type: Type.STRING, enum: ["rect", "circle"] },
                  fill: { type: Type.STRING },
                  stroke: { type: Type.STRING },
                  strokeWidth: { type: Type.NUMBER },
                  removeFromBackground: { type: Type.BOOLEAN },
                },
                required: ["kind", "name", "x", "y", "width", "height"],
              },
            },
          },
          required: ["elements"],
        },
      },
    }),
  );

  return JSON.parse(response.text || '{"elements":[]}');
}

export async function enhancePhoto(
  imageUrl: string,
  instruction: string,
  logoUrl?: string,
  options?: { imageSize?: "1K" | "2K"; promptEditRequest?: string }
): Promise<Buffer> {
  const model = "gemini-3.1-flash-image-preview";
  const ai = getAI();
  const promptEditPlan = options?.promptEditRequest
    ? await planPromptEditRequest(options.promptEditRequest, imageUrl)
    : null;

  const parts: any[] = [buildInlineImagePart(imageUrl)];
  if (logoUrl) {
    parts.push(buildInlineImagePart(logoUrl));
  }

  parts.push({
    text: `You are a professional photo editor. ${instruction}.
    ${promptEditPlan ? `${buildPromptEditPlanInstructions(promptEditPlan)}
    ` : ""}
    
    SPECIFIC TOOL RULES:
    - Smooth Skin: Only perform skin smoothing and blemish reduction. Do not alter face shape, eyes, lips, nose, jawline, or identity. Preserve facial landmarks and geometry. Keep pores and skin realism intact.
    - Fix Lighting: Adjust exposure, highlights, shadows, contrast, white balance, and tone only. Correct both overexposed and underexposed images cleanly while keeping skin tones natural and preserving the original subject and scene. Do not alter pose, face, hands, hair, body, or background content.
    - Sharpen: Sharpen detail only. No facial regeneration, no feature hallucination, no structure changes. Use unsharp mask/detail enhancement only.
    - Blur Background: Only blur the existing background. Make the depth-of-field separation much stronger and more premium than a subtle baseline while keeping the subject untouched and natural. Do not replace the scene. Do not recolor. Do not generate a new background. Preserve the original subject and background content exactly, just blurred.
    - Change Background: Analyze the original image and subject. Replace the background with a realistic new scene that matches the context or the user's specific request. STRICT RULE: Preserve the subject's face, identity, pose, body, hair, and clothing EXACTLY. Do not regenerate or alter the subject in any way. Only change the background.
    - Face Focus: Make the face focus enhancement stronger and cleaner while targeting only the visible face area. Increase facial clarity, local contrast, micro-sharpness, eye detail, and crisp natural focus without adding makeup, beauty changes, skin recoloring, facial distortion, or identity changes. STRICT RULE: Do not zoom, do not crop, do not change framing or composition, do not alter background content beyond very light natural separation, and do not create halos, oversharpening, or artificial skin.
    - Pro Headshot: Generate a professional business headshot. Improve crop, background, lighting, and polish. Maintain natural identity and face structure. No face replacement. Preserve exact facial identity.
    - Change Vibe: Apply a much stronger ambience, color, mood, and lighting-direction transformation while preserving subject identity, face geometry, body shape, pose, and important scene structure exactly. Keep the subject recognisable, realistic, and premium. Do not distort or restyle the person into a different identity.
    - Remove Clutter: Detect visual distractions more accurately, distinguish subject vs clutter carefully, preserve important props and subject edges, remove only distractions, produce clean realistic fills, and blend surfaces so removals do not leave artifacts, warping, or smeared textures.
    - Edit With Prompt: Treat this as a localized in-place photo editing tool, not a background replacement tool. Understand the user's requested change semantically before editing. Make exactly the requested change, keep the edit as localized as possible, preserve the full original composition, and do not modify any unrelated region. Unless the execution plan explicitly says background change allowed: yes, the background must remain visually unchanged. Do not replace, repaint, recolor, blur, restyle, regenerate, extend, remove, or relight the background when the user asked for a clothing, body-area, object, vehicle, text, accessory, or local subject edit. If the user explicitly asks to modify a protected area such as hair, smile, skin, body contour, bust size, facial hair, or another identity-adjacent detail, carry out that exact request while keeping the same person recognisable, realistic, and consistent overall. If the user explicitly asks to add or replace an object, vehicle part, accessory, clothing detail, wheel/tyre style, product element, or decorative item, do that exact addition or replacement cleanly and intelligently without breaking the rest of the image.
    - Fix Type: Analyze all text and typography in the design. Detect and fix typos and grammatical errors. Improve weak or boring copy to be more engaging and high-traction. Optimize wording to fit the design's intent and layout perfectly. Preserve the overall design style and message.
    - Make Professional / Brand Photo: Brand the uploaded photo itself. Keep the original photo recognisable and intact. Add only the provided logo and only the requested user text as a premium editorial overlay, luxury lower-third, refined translucent brand panel, elegant corner lockup, or polished gradient/fade treatment. If no logo is provided, do not invent one. If no user text is provided, do not add any text. Use strong hierarchy, clean spacing, balanced margins, tasteful typography, subtle shadows, precise logo placement, and commercial social-ad polish. Do not make it look like a basic sticker or plain text strip. Do not turn the photo into a separate poster or unrelated graphic. Do not damage the logo.
    - Level Up Business Tools: For Mockup Generator, Food Enhancer, Brand Photo, and Product/Studio shots, make the result premium enough for a paid commercial app. Prefer realistic professional lighting, controlled contrast, clean materials, accurate perspective, tasteful brand restraint, sharp detail, and artifact-free execution. Do not use cheap AI gloss, warped backgrounds, random text, distorted logos, or overprocessed effects.
    
    STRICT GLOBAL SUBJECT RULE: Do not change the subject's structure, anatomy, pose, identity, likeness, or facial geometry. Preserve eyes, nose, lips, jawline, cheeks, skin texture placement, hairline, expression anatomy, and body proportions exactly. Never face-swap, beautify by morphing, regenerate a different person, or subtly change facial features.
    STRICT BODY RULE: Body changes, pose changes, limb changes, hand changes, or posture changes are forbidden for every tool except Pose Perfect. Only Pose Perfect may change the body, and only according to the user's explicit instruction.
    STRICT BACKGROUND RULE: Preserve important scene elements unless the tool explicitly requests removal or replacement. Do not accidentally alter protected objects, clothing details, or subject accessories.
    STRICT TOOL BOUNDARY RULE: Execute only the requested tool effect. If the request is to extend a background, fill only the missing edge area and do not replace existing background pixels. If the request is to replace a background, change only the background and keep the original subject exactly. If the request is to improve lighting, sharpness, skin, focus, or polish, do not add overlays, new scenery, new props, or decorative elements.
    STRICT TEXT RULE: Do not add text, app names, watermarks, captions, labels, signatures, fake logos, fake contact details, or filler copy unless the selected tool explicitly asks for user-provided text or a user-provided logo. When text is allowed, use only the exact user-provided text and logo assets.
    STRICT TYPOGRAPHY RULE: Never generate gibberish, pseudo-language, broken letter clusters, decorative fake writing, random menu text, fake signs, fake packaging copy, or unreadable microtext. If exact clean text cannot be produced, omit the text rather than hallucinating it.
    STRICT VISUAL ASSET RULE: Do not insert unrelated extra images, extra subjects, stickers, icons, decorative objects, fake products, fake people, fake props, or unrelated visual elements that were not supplied by the user, unless a tool explicitly requires a background replacement or a direct requested scene extension.
    DETECTION RULE: Analyze the full image carefully before editing. Detect the main subject, face, body, hands, hair edges, logos, typography, important props, protected objects, background boundaries, clutter regions, lighting problems, and user-requested target area with high precision.
    REQUEST UNDERSTANDING RULE: Interpret the user's tool request literally and intelligently. Infer the most useful premium-quality execution from the request without changing protected identities or protected scene content.
    SPEED AND OUTPUT RULE: Return exactly one finished image directly. Do not create multiple variants, contact sheets, before/after panels, explanations, captions, or extra layout experiments.
    QUALITY RULE: Keep the result natural, premium, artifact-free, professionally finished, commercially polished, and stronger than a basic edit.
    EXECUTION RULE: Produce the strongest high-quality result that still looks believable and intentional. Avoid cheap-looking effects, weak composition, muddy detail, broken anatomy, warped text, low-end styling, unfinished surfaces, weak edits, and partial changes.
    COMPLETION RULE: If the image is challenging but still possible to edit, produce the best clean premium result rather than refusing. Only return no image when the request is genuinely impossible, unsafe, or the image has no usable visual content.`,
  });

  return generateImageWithRecovery(ai, {
    model,
    parts,
    imageSize: options?.imageSize || getDefaultImageSize(),
    recoveryText: promptEditPlan
      ? `Re-run the edit using the same structured prompt-edit plan and complete the requested change instead of refusing. Requested outcome: ${promptEditPlan.requestedOutcome}. Target area: ${promptEditPlan.targetArea}. Keep exactly: ${promptEditPlan.keepExactly.join(", ")}. Forbidden changes: ${promptEditPlan.forbiddenChanges.join(", ")}. Preserve identity and unrelated content exactly while delivering one premium finished image.`
      : "Re-read the user's request more intelligently and complete the edit instead of refusing when a usable result is possible. Detect protected faces, body areas, text, logo, lighting issues, clutter zones, and background boundaries precisely. Apply the requested change more cleanly and more strongly, preserve identities exactly, and return one finished premium image.",
  });
}

export async function createBusinessGraphic(input: ServerBusinessGraphicInput): Promise<Buffer> {
  const model = "gemini-3.1-flash-image-preview";
  const ai = getAI();

  const additionalImageUrls = (input.additionalImageUrls || []).filter(Boolean);
  const parts: any[] = [];

  additionalImageUrls.forEach((imageUrl, index) => {
    parts.push({ text: `Supporting reference image ${index + 1}.` });
    parts.push(buildInlineImagePart(imageUrl));
  });

  if (input.logoUrl) {
    parts.push({ text: "Brand logo asset. Preserve logo integrity exactly." });
    parts.push(buildInlineImagePart(input.logoUrl));
  }

  const filledFields = Object.entries(input.fields || {})
    .filter(([, value]) => String(value || "").trim().length)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n") || "- No structured fields were provided";
  const visibleTextAllowlist = buildVisibleTextAllowlist(input);
  const visibleTextInventory = visibleTextAllowlist.length
    ? visibleTextAllowlist.map((text) => `- "${text}"`).join("\n")
    : "- No visible text is allowed unless it already exists inside an uploaded logo/image.";

  parts.push({
    text: `You are a premium graphic design generator.
Create one extremely polished professional ${input.useType} using the provided assets and details. This must look like a finished agency-quality deliverable, not a simple generated template.

OUTPUT SPEC:
- Required format: ${input.outputFormat || "Not provided"}
- Size target: ${input.promptFormat || "Match the selected category standard size"}
- Canvas size target: ${input.canvasSize ? `${input.canvasSize.width}x${input.canvasSize.height}` : "Not provided"}

STRUCTURED CONTENT:
${filledFields}

VISIBLE TEXT ALLOWLIST:
${visibleTextInventory}

ADDITIONAL INPUT:
- Notes: ${input.notes || "Not provided"}
- Additional text to include on the graphic: ${input.additionalText || "Not provided"}
- Category-specific direction: ${input.promptDirection || "Not provided"}
- Transparent background required: ${input.transparentBackground ? "Yes" : "No"}

DESIGN GOALS:
- Understand the category, field values, uploaded assets, notes, and additional text with high precision before composing anything.
- Notes are art direction only. Do not render notes as visible copy unless the same wording also appears in the visible text allowlist.
- Field keys such as heading, venue, phone, email, callToAction, or date are role labels for you only. Never render those field key names unless the user typed them as visible text.
- Detect the true priority content automatically and build the layout around that hierarchy intelligently.
- Make the final result feel dramatically more premium than a typical template. It must look expensive, brand-led, and professionally art directed.
- Build strong hierarchy, elegant typography, balanced composition, refined spacing, clear alignment, disciplined margins, polished visual rhythm, and a clear focal point.
- Use a premium design system: confident headline scale, supporting text hierarchy, well-controlled negative space, tasteful accents, refined background treatment, professional color harmony, and precise image/logo placement.
- Make the design feel commercially ready, high-end, intentional, and professionally finished in every detail.
- Unless the user explicitly requests monochrome, grayscale, vintage fade, or muted minimalism, prefer rich premium colour, elegant contrast, refined materials, and polished visual depth over flat or dull styling.
- For invitations, cards, and social graphics, make the composition feel luxurious, celebratory, and premium rather than plain, washed out, or low-energy.
- If images are provided, use them meaningfully and art-direct them cleanly.
- If no images are provided, design a premium graphic from the text alone with a beautiful high-end background, composition, and supporting visual treatment that fits the category perfectly.
- Integrate the logo professionally if one was provided.
- Match the format and intent of a ${input.useType}.
- Respect the requested output format and size target while composing the layout.
- Make every line of important text clean, readable, attractive, and placed intentionally.
- Silently correct obvious typos, grammar, spacing, punctuation, and line breaks in ordinary marketing or greeting copy before placing it in the design.
- Preserve every proper noun exactly as provided by the user, including person names, business names, brand names, product names, social handles, email addresses, URLs, venue names, and other custom names. Do not respell or restyle those exact names.
- Use ONLY the exact strings in VISIBLE TEXT ALLOWLIST as visible text. Do not invent slogans, taglines, dates, names, contact details, headings, placeholder copy, app names, watermarks, signatures, filler text, fake letters, pseudo-words, decorative glyph text, or nonsense letter clusters.
- If a word is not in the visible text allowlist or inside an uploaded logo/image, it must not appear in the final graphic.
- If you cannot render a supplied string cleanly and legibly, simplify the layout around fewer/larger text blocks. Never replace it with gibberish or approximate letters.
- Do a final text audit before returning the image: remove any visible text that is not in the allowlist, and fix any malformed user-provided words.
- If a field, date, contact detail, price, venue, name, or message is missing from the input, leave it missing. Never fabricate placeholder details, lorem ipsum, pseudo-text, fake captions, or decorative text blocks.
- Use ONLY the uploaded logo and uploaded reference images as visual source material. Do not insert unrelated extra images, extra people, fake products, stock-photo elements, stickers, icons, decorative objects, or generated visual fillers that the user did not supply.
- If a business card is requested, create a front-only, ready-to-use professional business card asset with only the provided fields and optional provided logo/images.
- Avoid weak layout, bad text spacing, awkward centering, generic template look, clutter, distorted letters, or low-end styling.
- Avoid basic stock-template aesthetics, random decorations, cheap gradients, bad crops, fake transparent grids, weak type pairing, low contrast text, and amateur alignment.
- Preserve the identity of people, products, and important uploaded objects exactly.
- Do not distort faces, bodies, hands, hair, facial geometry, expression anatomy, skin structure, age, ethnicity, or identity.
- When uploaded photos contain people, preserve their faces and likeness exactly. You may improve lighting/crop/context only; never regenerate them as different people.
- Do not invent unrelated extra subjects.
- Keep text accurate, readable, and well arranged.
- Keep the result natural, premium, brand-ready, and commercially usable.
- For logo requests, keep the mark clean, scalable, centered, and professionally balanced.
- If transparent background is required, return a true transparent alpha background only. Do not add checkerboards, fake transparency grids, paper textures, solid fills, shadows, or placeholder backgrounds.

STRICT SAFETY RULES:
- Do not change a person's face, body, or identity.
- Do not remove important uploaded subject matter.
- Do not corrupt the logo.
- Do not add any text outside the visible text allowlist.
- Do not add gibberish, decorative fake letters, pseudo-language, broken typography, or meaningless microtext.
- Do not create messy layouts, overlapping text, weak spacing, or amateur-looking typography.

Return one finished graphic image only.`,
  });

  return generateImageWithRecovery(ai, {
    model,
    parts,
    imageSize: getDefaultImageSize(),
    recoveryText: `Interpret the requested category, all fields, notes, and assets more accurately. Use smarter hierarchy, stronger typography, better spacing, cleaner alignment, better asset placement, and a more premium agency-level finish. Preserve identities and logo integrity exactly. Render only these exact visible text strings: ${visibleTextAllowlist.join(" | ") || "none"}. Remove gibberish, fake microtext, and any invented words. Return one finished professional graphic.`,
  });
}

export async function planBusinessGraphicDesign(input: ServerBusinessGraphicInput): Promise<ServerBusinessGraphicPlan> {
  const model = "gemini-3.1-pro-preview";
  const ai = getAI();
  const additionalImageUrls = (input.additionalImageUrls || []).filter(Boolean);
  const parts: any[] = [];
  const availableAssetRefs = additionalImageUrls.map((_, index) => `reference_${index + 1}`);

  additionalImageUrls.forEach((imageUrl, index) => {
    parts.push({ text: `Reference image slot: reference_${index + 1}` });
    parts.push(buildInlineImagePart(imageUrl));
  });

  if (input.logoUrl) {
    parts.push({ text: "Brand logo slot: logo" });
    parts.push(buildInlineImagePart(input.logoUrl));
    availableAssetRefs.push("logo");
  }

  const filledFields = Object.entries(input.fields || {})
    .filter(([, value]) => String(value || "").trim().length)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n") || "- No structured fields were provided";

  const response = await withRetry(() =>
    ai.models.generateContent({
      model,
      contents: buildUserContents([
        ...parts,
        {
          text: `You are planning a premium editable drag-and-drop design for Chromancy.

Return only a structured design document plan in JSON. Do not return an image.

CRITICAL RULE:
- This JSON will be the source of truth for both the final preview image and the Design Studio editor.
- That means text must be real text layers, photos must be real image/frame layers, and decorative structure must be explicit shape/image layers.
- Do NOT flatten the design concept mentally. Think like a premium template designer building a layered design file.

CANVAS:
- Width: ${input.canvasSize?.width || 1080}
- Height: ${input.canvasSize?.height || 1080}
- Category: ${input.useType}
- Output format: ${input.outputFormat || "Not provided"}
- Format target: ${input.promptFormat || "Not provided"}
- Category direction: ${input.promptDirection || "Not provided"}
- Transparent background required: ${input.transparentBackground ? "Yes" : "No"}

STRUCTURED CONTENT:
${filledFields}

ADDITIONAL INPUT:
- Notes: ${input.notes || "Not provided"}
- Additional text: ${input.additionalText || "Not provided"}

AVAILABLE IMAGE ASSET REFS:
- ${availableAssetRefs.length ? availableAssetRefs.join(", ") : "No uploaded image assets are available"}
- Decorative asset refs you may use when appropriate: element_sparkle, element_flower, element_heart, element_star, element_ribbon

ALLOWED FONT FAMILIES:
- Poppins
- Montserrat
- Playfair Display
- DM Sans
- Bebas Neue
- Oswald
- Cormorant Garamond
- Merriweather
- Raleway
- Abril Fatface

ALLOWED TEXTURES:
- none
- gold_foil
- silver_metal
- rose_gold
- chrome_blue
- glass
- silk

YOUR JOB:
- Create a premium, professional, commercially polished layered design plan for this ${input.useType}.
- Make it feel expensive, intentional, and agency-quality.
- Use strong hierarchy, clean spacing, tasteful panels, dividers, frames, background shapes, and decorative touches where useful.
- Every visible editable object should be represented as a layer.
- Use absolute pixel coordinates, not normalized decimals.
- Keep all layer bounds inside the canvas.
- Use zIndex so higher layers sit above lower layers.
- Use ONLY the exact user-provided text. Do not invent slogans, fake details, fake dates, fake contact info, app names, watermarks, or filler copy.
- Preserve proper nouns exactly.
- If photo/logo assets are available, place them professionally using image layers with assetRef.
- If an image sits inside a frame, use frameShape and borderRadius so the frame remains editable and replaceable later.
- Use shape layers for panels, dividers, outline boxes, badges, overlays, and background blocks.
- If no image assets are available, do not invent stock photos. Build a premium text-led design instead.
- Prefer rich premium colour and contrast over dull flat styling unless the request clearly implies otherwise.
- Make the resulting plan easy to edit in a phone-friendly design editor.

RETURN QUALITY BAR:
- The finished rendered result must look like a premium drag-and-drop template, not a cheap placeholder.
- Use multiple layers where needed to achieve polish.
- Include every important text line as its own text layer or clearly intentional grouped text block.

VALIDATION:
- image layers must use assetRef values from the allowed list above
- decorative image layers may use element_* refs
- text layers must include text
- shape layers must include shape and fill
- do not leave giant blank areas unless it improves premium composition`,
        },
      ]),
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            backgroundColor: { type: Type.STRING },
            layers: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  kind: { type: Type.STRING, enum: ["text", "image", "shape"] },
                  name: { type: Type.STRING },
                  x: { type: Type.NUMBER },
                  y: { type: Type.NUMBER },
                  width: { type: Type.NUMBER },
                  height: { type: Type.NUMBER },
                  rotation: { type: Type.NUMBER },
                  opacity: { type: Type.NUMBER },
                  zIndex: { type: Type.NUMBER },
                  role: {
                    type: Type.STRING,
                    enum: ["headline", "body", "panel", "badge", "logo", "photo", "product", "decorative", "frame", "sticker", "icon"],
                  },
                  text: { type: Type.STRING },
                  color: { type: Type.STRING },
                  fontFamily: {
                    type: Type.STRING,
                    enum: ["Poppins", "Montserrat", "Playfair Display", "DM Sans", "Bebas Neue", "Oswald", "Cormorant Garamond", "Merriweather", "Raleway", "Abril Fatface"],
                  },
                  fontSize: { type: Type.NUMBER },
                  fontWeight: { type: Type.NUMBER },
                  letterSpacing: { type: Type.NUMBER },
                  textAlign: { type: Type.STRING, enum: ["left", "center", "right"] },
                  assetRef: { type: Type.STRING },
                  fit: { type: Type.STRING, enum: ["contain", "cover"] },
                  frameShape: { type: Type.STRING, enum: ["rectangle", "rounded", "circle"] },
                  borderRadius: { type: Type.NUMBER },
                  cropX: { type: Type.NUMBER },
                  cropY: { type: Type.NUMBER },
                  cropScale: { type: Type.NUMBER },
                  shape: { type: Type.STRING, enum: ["rect", "circle", "line"] },
                  fill: { type: Type.STRING },
                  stroke: { type: Type.STRING },
                  strokeWidth: { type: Type.NUMBER },
                  texture: {
                    type: Type.STRING,
                    enum: ["none", "gold_foil", "silver_metal", "rose_gold", "chrome_blue", "glass", "silk"],
                  },
                },
                required: ["kind", "name", "x", "y", "width", "height"],
              },
            },
          },
          required: ["title", "backgroundColor", "layers"],
        },
      },
    }),
  );

  return JSON.parse(response.text || '{"title":"Generated Design","backgroundColor":"#111111","layers":[]}');
}

export async function renderBusinessGraphicDesignPlan(
  input: ServerBusinessGraphicInput,
  plan: ServerBusinessGraphicPlan,
): Promise<Buffer> {
  const model = "gemini-3.1-flash-image-preview";
  const ai = getAI();
  const additionalImageUrls = (input.additionalImageUrls || []).filter(Boolean);
  const parts: any[] = [];
  const availableAssetRefs = additionalImageUrls.map((_, index) => `reference_${index + 1}`);

  additionalImageUrls.forEach((imageUrl, index) => {
    parts.push({ text: `Reference image slot: reference_${index + 1}` });
    parts.push(buildInlineImagePart(imageUrl));
  });

  if (input.logoUrl) {
    parts.push({ text: "Brand logo slot: logo" });
    parts.push(buildInlineImagePart(input.logoUrl));
    availableAssetRefs.push("logo");
  }

  parts.push({
    text: `You are rendering a premium final graphic from a structured Chromancy design document.

CRITICAL:
- The design JSON below is the source of truth.
- Render the final finished graphic from that design document.
- Follow the layer layout, hierarchy, frame placements, and text content as closely as possible.
- Keep the result premium, polished, and commercially professional.
- Do not invent extra text, logos, people, contact details, slogans, or decorative content that is not already implied by the design document.
- Use uploaded image assets only through their mapped assetRef slots.
- Preserve every proper noun exactly.
- If an image layer has a frame shape, keep that frame look in the rendered result.
- If the design has a background colour or background structure, render it cleanly and intentionally.

CANVAS:
- Width: ${input.canvasSize?.width || 1080}
- Height: ${input.canvasSize?.height || 1080}
- Category: ${input.useType}
- Output format: ${input.outputFormat || "Not provided"}
- Format target: ${input.promptFormat || "Not provided"}
- Transparent background required: ${input.transparentBackground ? "Yes" : "No"}

ASSET REF MAP:
- ${availableAssetRefs.length ? availableAssetRefs.join(", ") : "No uploaded asset refs are available"}
- Decorative refs may appear in the plan: element_sparkle, element_flower, element_heart, element_star, element_ribbon

DESIGN JSON:
${JSON.stringify(plan, null, 2)}

RETURN:
- One finished premium graphic image only.
- The rendered image must visually match the supplied design document, not a different layout.`,
  });

  return generateImageWithRecovery(ai, {
    model,
    parts,
    imageSize: getDefaultImageSize(),
    recoveryText: "Render the supplied design JSON more faithfully. Keep all text accurate, preserve frame positions, maintain the composition, and return one premium final graphic image.",
  });
}

export async function removeObject(imageUrl: string, maskUrl: string, instruction: string): Promise<Buffer> {
  const model = "gemini-2.5-flash-image";
  const ai = getAI();
  const { base64Data, mimeType } = parseDataUrl(imageUrl);
  const { base64Data: maskBase64 } = parseDataUrl(maskUrl);

  const response = await withRetry(() =>
    ai.models.generateContent({
      model,
      contents: buildUserContents([
        {
          inlineData: {
            data: base64Data,
            mimeType,
          },
        },
        {
          inlineData: {
            data: maskBase64,
            mimeType: "image/png",
          },
        },
        {
          text: `You are a precise object remover.
Remove ONLY the exact pixels highlighted in white in the provided mask image.
The mask is the absolute source of truth.
Do not attempt to detect or remove entire objects if they extend beyond the mask.
Do not remove semantically similar objects.
Do not expand the removal area.
Use clean inpainting from the immediate surrounding pixels so the background texture, lighting, edges, and perspective blend naturally.
Preserve every unmasked pixel exactly.
Do not add text, watermarks, logos, new objects, replacement subjects, or unrelated visual elements.
If the mask is small or imperfect but still usable, complete the cleanest possible local inpaint rather than refusing. Only return no image when there is truly no usable mask or image content.
${instruction}`,
        },
      ]),
    })
  );

  return extractGeneratedImageBuffer(response);
}

export async function generateVideo(imageUrl: string, prompt: string): Promise<ServerVideoResult> {
  const { base64Data, mimeType } = parseDataUrl(imageUrl);
  const ai = getAI();
  const startedAt = Date.now();
  const overallDeadline = startedAt + AI_VIDEO_TIMEOUT_MS;
  const attemptBudgetMs = Math.max(
    45_000,
    Math.min(
      Number(process.env.CHROMANCY_AI_VIDEO_ATTEMPT_TIMEOUT_MS || 90_000),
      AI_VIDEO_TIMEOUT_MS,
    ),
  );
  const configuredVideoModel = process.env.CHROMANCY_AI_VIDEO_MODEL;
  const fallbackVideoModel = process.env.GEMINI_VIDEO_MODEL;
  const videoModels = Array.from(new Set([
    configuredVideoModel,
    "veo-3.1-fast-generate-preview",
    "veo-3.1-generate-preview",
    fallbackVideoModel,
    "veo-2.0-generate-001",
  ].filter((model): model is string => !!model?.trim())));
  const animatePlan = await planAnimateRequest(imageUrl, prompt);
  const promptVariants = buildAnimatePromptVariants(animatePlan);
  const videoConfig: Record<string, unknown> = {
    numberOfVideos: 1,
    resolution: process.env.CHROMANCY_AI_VIDEO_RESOLUTION || "720p",
  };
  const requestedAspectRatio = process.env.CHROMANCY_AI_VIDEO_ASPECT_RATIO;
  if (requestedAspectRatio) {
    videoConfig.aspectRatio = requestedAspectRatio;
  }

  let lastVideoError: unknown = null;
  for (const promptVariant of promptVariants) {
    for (const model of videoModels) {
      if (Date.now() >= overallDeadline) {
        throw new Error("AI_VIDEO_TIMEOUT");
      }

      try {
        const attemptDeadline = Math.min(overallDeadline, Date.now() + attemptBudgetMs);
        let operation = await withRetry(() =>
          ai.models.generateVideos({
            model,
            prompt: promptVariant,
            image: {
              imageBytes: base64Data,
              mimeType,
            },
            config: videoConfig as any,
          }),
        );

        while (!operation.done) {
          const now = Date.now();
          if (now >= overallDeadline) {
            throw new Error("AI_VIDEO_TIMEOUT");
          }
          if (now >= attemptDeadline) {
            throw new Error("AI_VIDEO_ATTEMPT_TIMEOUT");
          }

          await new Promise((resolve) => setTimeout(resolve, AI_VIDEO_POLL_INTERVAL_MS));
          operation = await withRetry(() =>
            ai.operations.getVideosOperation({ operation }),
          );

          if (operation.error) {
            throw new Error(String(operation.error.message) || "AI_VIDEO_GENERATION_FAILED");
          }
        }

        if (operation.error) {
          throw new Error(String(operation.error.message) || "AI_VIDEO_GENERATION_FAILED");
        }

        const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
        if (!downloadLink) {
          throw new Error("AI_VIDEO_GENERATION_FAILED");
        }

        const response = await withRetry(async () => {
          const headers = await getVideoDownloadHeaders();
          let videoResponse = await fetch(downloadLink, {
            method: "GET",
            headers,
          });

          if (!videoResponse.ok && !useVertexAI() && !/[?&]key=/.test(downloadLink)) {
            const separator = downloadLink.includes("?") ? "&" : "?";
            videoResponse = await fetch(`${downloadLink}${separator}key=${encodeURIComponent(getApiKey())}`, {
              method: "GET",
            });
          }

          if (!videoResponse.ok) {
            throw new Error(`Failed to download generated video (${videoResponse.status})`);
          }

          return await withTimeout(Promise.resolve(videoResponse), AI_MODEL_TIMEOUT_MS, "AI_REQUEST_TIMEOUT");
        }, 4, 1200);

        const arrayBuffer = await response.arrayBuffer();
        return {
          buffer: Buffer.from(arrayBuffer),
          mimeType: response.headers.get("content-type") || "video/mp4",
        };
      } catch (error) {
        lastVideoError = error;
        if (isAiProviderConfigError(error) || isVertexRoleRequestError(error)) {
          throw error;
        }
        if (String((error as any)?.message || error || "") === "AI_VIDEO_TIMEOUT") {
          throw error;
        }
        console.warn(`Video generation attempt failed for model ${model}; trying the next animate fallback.`, error);
      }
    }
  }

  if (String((lastVideoError as any)?.message || lastVideoError || "") === "AI_VIDEO_TIMEOUT") {
    throw lastVideoError as any;
  }

  throw new Error("AI_VIDEO_GENERATION_FAILED");
}

export async function posePerfect(imageUrl: string, instruction: string): Promise<Buffer> {
  const model = "gemini-2.5-flash-image";
  const ai = getAI();
  const { base64Data, mimeType } = parseDataUrl(imageUrl);

  return generateImageWithRecovery(ai, {
    model,
    parts: [
      {
        inlineData: {
          data: base64Data,
          mimeType,
        },
      },
      {
        text: `You are a professional pose adjustment editor. ${instruction}.
Subtly adjust the pose, improve posture, or correct positioning as requested.
DETECTION RULE: Detect the true body pose, limb positions, hand placement, weight balance, and clothing boundaries before editing.
STRICT RULE: Preserve the subject's face, identity, and facial features EXACTLY. Do not alter the face shape, eyes, nose, lips, jawline, cheeks, expression anatomy, or identity. Only modify the body positioning.
STRICT BACKGROUND AND ASSET RULE: Do not replace the background, do not add text, do not add props, do not add extra people, and do not insert unrelated visual elements.
QUALITY RULE: Keep the result natural, premium, anatomically believable, well lit, crisp, and professionally finished.
COMPLETION RULE: If the pose request is possible, complete the cleanest believable edit rather than refusing. Only return no image when there is no usable person, body, or pose information in the image.
No sexual content, no anatomy exaggeration, no nudity.`,
      },
    ],
    imageSize: getDefaultImageSize(),
    recoveryText: "Re-evaluate the body pose more accurately. Correct only the requested pose or posture issue, keep facial identity unchanged, preserve anatomy and clothing boundaries, and return one clean finished pose edit.",
  });
}

export async function predictPerformance(imageUrl: string): Promise<ServerPerformancePrediction> {
  const model = "gemini-3.1-pro-preview";
  const ai = getAI();
  const { base64Data, mimeType } = parseDataUrl(imageUrl);

  const response = await withRetry(() =>
    ai.models.generateContent({
      model,
      contents: buildUserContents([
        {
          text: "Analyze this marketing visual and predict its likely performance based on design principles, attention flow, and engagement heuristics. Provide a score from 0-100 and a detailed reasoning explaining strengths and weaknesses. Respond in JSON format.",
        },
        {
          inlineData: {
            data: base64Data,
            mimeType,
          },
        },
      ]),
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER },
            reasoning: { type: Type.STRING },
          },
          required: ["score", "reasoning"],
        },
      },
    })
  );

  return JSON.parse(response.text || "{}");
}
