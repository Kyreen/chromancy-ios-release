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
  subjectType: "person" | "baby" | "animal" | "vehicle" | "food" | "product" | "object" | "scene" | "graphic";
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

// CLOTHES CHANGER — structured outfit plan produced by a vision pass before rendering,
// so the image model executes against precise garment/subject analysis instead of a
// raw sentence. Mirrors the promptEditPlan architecture.
interface ServerOutfitPlan {
  subjectDescription: string;
  framing: string;
  detectedGarments: string[];
  garmentsToReplace: string[];
  garmentsToKeep: string[];
  requestedOutfit: string;
  garmentSpec: string[];
  occlusions: string[];
  newlyExposedSkin: string[];
  accessoriesToPreserve: string[];
  lightingAndScene: string;
  executionNotes: string[];
  modestyAdjusted: boolean;
}

// EXTEND PHOTO / CHANGE BACKGROUND — scene analysis produced before rendering so the
// image model continues real geometry, lighting, and optics instead of guessing. This is
// what prevents the visible "seam" where the original photo ends.
interface ServerScenePlan {
  mode: "extend" | "replace";
  sceneType: string;
  subjectDescription: string;
  subjectBoundary: string[];
  backgroundElements: string[];
  geometry: string[];
  lightingProfile: string;
  opticalCharacteristics: string[];
  continuationPlan: string[];
  seamRisks: string[];
  specialCases: string[];
}

// RESIZE DESIGN — structured layout plan for adapting a flattened design to a new canvas.
interface ServerDesignResizePlan {
  designType: string;
  currentOrientation: string;
  targetOrientation: string;
  detectedElements: string[];
  textInventory: string[];
  focalElement: string;
  layoutPlan: string[];
  backgroundStrategy: string;
  riskNotes: string[];
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

function getVideoLocation(): string {
  // Veo needs a regional endpoint (for example us-central1), not "global".
  // Override with CHROMANCY_AI_VIDEO_LOCATION if your Veo access is in another region.
  return String(process.env.CHROMANCY_AI_VIDEO_LOCATION || "us-central1").trim();
}

function getVideoAI() {
  if (useVertexAI()) {
    const project = getVertexProject();
    if (!project) {
      throw new Error("VERTEX_AI_CONFIG_REQUIRED");
    }
    return new GoogleGenAI({
      vertexai: true,
      project,
      location: getVideoLocation(),
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
const AI_VIDEO_TIMEOUT_MS = Math.max(AI_MODEL_TIMEOUT_MS, Number(process.env.CHROMANCY_AI_VIDEO_TIMEOUT_MS || 540_000));
const AI_VIDEO_POLL_INTERVAL_MS = Math.max(1_000, Number(process.env.CHROMANCY_AI_VIDEO_POLL_INTERVAL_MS || 1_500));

function getDefaultImageSize(): "1K" | "2K" {
  return String(process.env.CHROMANCY_AI_IMAGE_SIZE || "1K").toUpperCase() === "2K" ? "2K" : "1K";
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
    subjectType: "scene",
    primarySubject: "the most visually important subject in the uploaded image",
    motionStrategy: "Use the strongest believable premium motion for the detected content and make the animation obviously alive from the first second. Lead with clear primary-subject motion whenever the subject can move naturally. If the subject is static, create unmistakable premium motion with controlled cinematic camera travel, layered depth parallax, moving reflections, atmosphere, light sweeps, energy motion, environmental life, or highlight motion while keeping the original composition elegant and stable.",
    secondaryMotion: [
      "Motion must be clearly visible early in the clip and must never read like a frozen still with tiny accidental movement.",
      "Add tasteful support motion that fits the content type and reinforces the main movement without noise or wobble.",
      "Prefer an obviously animated premium result over a safe near-static output.",
      "For people, use believable blink, breathing, posture life, hair sway, cloth movement, hand micro-motion, or expression life where appropriate.",
      "For products, cars, interiors, graphics, or food, use elegant camera push, drift, parallax, light sweeps, reflections, atmosphere, or surface shimmer that reads premium and intentional.",
    ],
    keepStable: [
      "Keep identity, framing, composition, text, and important geometry stable.",
      "Keep subject edges, facial structure, products, wheels, logos, text, and unrelated regions calm and artifact-free.",
    ],
    avoid: [
      "Avoid whole-frame wobble, morphing, duplicate limbs, warped faces, broken text, and rubbery motion.",
      "Do not output a barely-moving clip that still reads like a static image.",
      "Do not refuse a usable still image just because it has no face or limited natural motion.",
      "Avoid weak motion, random drift, breathing walls, melted geometry, floating accessories, or unstable perspective.",
    ],
    preferCameraOnly: false,
  };
}

function getSubjectMotionDirective(plan: ServerAnimatePlan): string {
  const name = plan.primarySubject;
  switch (plan.subjectType) {
    case "person":
      return `The primary subject is a PERSON: ${name}. Animate the person directly — show natural breathing (chest/shoulders rise and fall), realistic eye blink, subtle head micro-movement, hair gently swaying, clothing fabric moving. If hands are visible, add subtle finger or hand micro-motion. The PERSON must visibly move from the first second — do not only move the camera.`;
    case "baby":
      return `The primary subject is a BABY: ${name}. Animate with very gentle tender motion — soft breathing (tummy/chest gently rising and falling), tiny finger curl or hand flutter, subtle eye movement, light head tilt. Keep motion slow, gentle, and lifelike. The baby must visibly breathe and feel alive.`;
    case "animal":
      return `The primary subject is an ANIMAL: ${name}. Animate the animal directly — natural breathing, ear flick or swivel, tail wag or sway, nose/whisker twitch, blinking, small head turn. The ANIMAL must visibly move — do not only move the camera.`;
    case "vehicle":
      return `The primary subject is a VEHICLE: ${name}. Show gentle forward motion or idle engine rumble, wheels slowly spinning, light reflections moving across body panels, suspension micro-movement. Add a slow camera arc or pull-back to show the vehicle in motion. Make it feel powerful and alive.`;
    case "food":
      return `The primary subject is FOOD or a BEVERAGE: ${name}. Show rising steam wisps, condensation droplets forming, liquid shimmer or gentle surface ripple, ambient warm light glowing on the food. Make it look freshly prepared, appetising, and alive.`;
    case "product":
      return `The primary subject is a PRODUCT: ${name}. Show a slow elegant rotation or reveal, a light sweep or glint across the surface, a depth-of-field shift drawing focus, or a subtle camera drift. Make it look premium, polished, and desirable.`;
    case "object":
      return `The primary subject is an OBJECT: ${name}. Animate with natural physics-based motion — a ball bounces or rolls, a flower sways, a flag ripples, a candle flame flickers, a pendulum swings. Choose the most natural believable motion for this exact object and make it clearly move from the first second.`;
    case "graphic":
      return `The primary subject is a GRAPHIC or POSTER: ${name}. Animate with a smooth camera push-in toward the focal point, a light sweep across the surface, or elegant parallax layers creating depth. Make it feel dynamic and premium without distorting the design.`;
    case "scene":
    default:
      return `The image shows a SCENE: ${name}. Animate with parallax depth (foreground moves slightly faster than background), environmental life (clouds drifting, leaves moving, water rippling, light rays shifting), and subtle cinematic camera drift. Make the scene feel alive and immersive from the first second.`;
  }
}

function buildAnimatePromptVariants(plan: ServerAnimatePlan) {
  const normalizedPrompt = normalizePromptText(plan.normalizedPrompt);
  const secondaryMotion = plan.secondaryMotion.join(" | ");
  const keepStable = plan.keepStable.join(" | ");
  const avoid = plan.avoid.join(" | ");
  const subjectDirective = getSubjectMotionDirective(plan);

  return Array.from(new Set([
    `Animate this still photo into a premium living clip. ${subjectDirective}
Content type: ${plan.contentType}.
Secondary motion: ${secondaryMotion}
Keep stable: ${keepStable}
Avoid: ${avoid}
The finished clip must show unmistakable subject motion from the first second. Never produce a near-static output.
User intent: ${normalizedPrompt}`,

    `Create a premium animated video from this still image. CRITICAL: The main subject must visibly move — do not animate only the camera or background while the subject stays frozen.
Subject type: ${plan.subjectType}. Primary subject: ${plan.primarySubject}.
Motion strategy: ${plan.motionStrategy}
Additional motion: ${secondaryMotion}
The clip must be clearly, obviously animated with the ${plan.subjectType} in motion. User intent: ${normalizedPrompt}`,

    `Fallback: produce a visibly animated premium clip from this still image. Animate the ${plan.subjectType} — ${plan.primarySubject} — using ${plan.motionStrategy}. If direct subject motion is limited, combine subject micro-motion with restrained camera movement. Keep the result clean, premium, and clearly animated. ${normalizedPrompt}`,

    `Emergency fallback: produce one clean animated living-photo clip. Prioritize making the ${plan.subjectType} visibly move. Never output a near-static clip. Preserve faces, bodies, products, text, and composition exactly. ${normalizedPrompt}`,
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
        // Fast model for the internal edit-PLANNING JSON only (not the rendered
        // image), so complex edits generate faster. Override with CHROMANCY_AI_PLAN_MODEL.
        model: process.env.CHROMANCY_AI_PLAN_MODEL || "gemini-2.5-flash",
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

// ---------------------------------------------------------------------------
// CLOTHES CHANGER — vision planning pass
// ---------------------------------------------------------------------------

function createFallbackOutfitPlan(rawRequest: string): ServerOutfitPlan {
  const requestedOutfit = normalizePromptText(rawRequest);
  return {
    subjectDescription: "The main person visible in the photo.",
    framing: "Preserve the original framing and crop exactly.",
    detectedGarments: ["All clothing currently worn by the subject"],
    garmentsToReplace: ["Every garment required to achieve the requested outfit"],
    garmentsToKeep: ["Any garment the request does not ask to change"],
    requestedOutfit: requestedOutfit || "The outfit described by the user.",
    garmentSpec: ["Match the requested garment type, colour, material, fit, and length exactly."],
    occlusions: ["Arms, hair, bags, or props overlapping the clothing"],
    newlyExposedSkin: ["Any skin revealed by the new outfit"],
    accessoriesToPreserve: ["Glasses", "Jewellery", "Watches", "Bags", "Headwear"],
    lightingAndScene: "Match the original lighting direction, intensity, colour temperature, and shadows.",
    executionNotes: [
      "Detect the subject and every garment precisely before editing.",
      "Fit the outfit to the existing body — never reshape the body to fit the outfit.",
      "Remove all traces of the previous outfit with no ghosting or edge artifacts.",
    ],
    modestyAdjusted: false,
  };
}

function buildOutfitPlanInstructions(plan: ServerOutfitPlan) {
  return `CLOTHES CHANGER EXECUTION PLAN (follow exactly):
- Subject: ${plan.subjectDescription}
- Framing: ${plan.framing}
- Garments detected in the photo: ${plan.detectedGarments.join("; ")}
- Garments to REPLACE: ${plan.garmentsToReplace.join("; ")}
- Garments to KEEP unchanged: ${plan.garmentsToKeep.join("; ")}
- Requested outfit: ${plan.requestedOutfit}
- Required garment details: ${plan.garmentSpec.join("; ")}
- Occlusions to reconstruct carefully: ${plan.occlusions.join("; ")}
- Newly exposed skin to render naturally: ${plan.newlyExposedSkin.join("; ")}
- Accessories that must survive untouched: ${plan.accessoriesToPreserve.join("; ")}
- Lighting and scene to match: ${plan.lightingAndScene}
- Execution notes: ${plan.executionNotes.join("; ")}
${plan.modestyAdjusted ? "- SAFETY: The request was adjusted to a modest, age-appropriate, non-explicit interpretation. Render only that adjusted version." : ""}`;
}

async function planOutfitChange(rawRequest: string, imageUrl?: string): Promise<ServerOutfitPlan> {
  const fallback = createFallbackOutfitPlan(rawRequest);
  const normalizedRequest = normalizePromptText(rawRequest);
  if (!normalizedRequest) return fallback;

  try {
    const ai = getAI();
    const plannerParts: any[] = [];
    if (imageUrl) {
      plannerParts.push(buildInlineImagePart(imageUrl));
    }
    plannerParts.push({
      text: `You are an expert fashion retoucher and wardrobe stylist planning a clothing replacement for Chromancy.

Study the uploaded photo with extreme care, then convert the user's outfit request into a precise execution plan.

STEP 1 — DETECT THE SUBJECT:
- Identify the main person: their pose, body orientation, visible body regions, and how much of them is in frame (headshot, half body, full body).
- Note the exact framing and crop so it is preserved.

STEP 2 — DETECT EVERY GARMENT WITH PRECISION:
- List each garment currently worn: tops, bottoms, dresses, outerwear, footwear, headwear, and any layered pieces.
- Include garment regions that are partially hidden behind arms, hair, bags, props, or the edge of frame.
- Distinguish clothing from non-clothing accessories (glasses, jewellery, watches, bags, hats worn as accessories).

STEP 3 — UNDERSTAND THE REQUEST EXACTLY:
- Interpret precisely what the user asked for. Extract garment type, colour, material/fabric, pattern, fit, length, sleeve style, neckline, and any styling details they specified.
- If the user named only one garment (for example "swimsuit" or "black suit"), decide sensibly which existing garments must be replaced to achieve that outfit coherently, and which should stay.
- If the user's request is vague, infer the most flattering, realistic, professional interpretation that clearly satisfies what they asked for. Never ignore or water down an explicit instruction.
- Do not add garments or styling the user did not ask for beyond what is needed to make the outfit coherent.

STEP 4 — PLAN THE RENDER:
- Note which areas of skin will be newly exposed by the new outfit and must be reconstructed to match the subject's visible skin tone and texture.
- Note occlusions that must be rebuilt cleanly so the new garment sits correctly behind arms, hair, bags, and props.
- Describe the scene lighting direction, intensity, colour temperature, and shadows that the new garment must match.

SAFETY:
- Keep every result tasteful and non-explicit. Ordinary swimwear is acceptable when requested; nudity, lingerie-as-outerwear, transparent clothing, and sexualized framing are not.
- If the subject appears to be a minor, plan only modest, age-appropriate clothing regardless of the request, and set modestyAdjusted to true.
- Otherwise set modestyAdjusted to true only if you had to soften the request for safety.

HARD RULES:
- The subject's face, identity, hair, skin tone, body shape and proportions, pose, and hands must remain EXACTLY unchanged.
- The background must remain EXACTLY unchanged.
- Fit the outfit to the existing body. Never reshape the body to fit the outfit.
- Do not refuse. Produce the best safe, high-quality plan.

User outfit request:
${normalizedRequest}`,
    });

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: process.env.CHROMANCY_AI_PLAN_MODEL || "gemini-2.5-flash",
        contents: buildUserContents(plannerParts),
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              subjectDescription: { type: Type.STRING },
              framing: { type: Type.STRING },
              detectedGarments: { type: Type.ARRAY, items: { type: Type.STRING } },
              garmentsToReplace: { type: Type.ARRAY, items: { type: Type.STRING } },
              garmentsToKeep: { type: Type.ARRAY, items: { type: Type.STRING } },
              requestedOutfit: { type: Type.STRING },
              garmentSpec: { type: Type.ARRAY, items: { type: Type.STRING } },
              occlusions: { type: Type.ARRAY, items: { type: Type.STRING } },
              newlyExposedSkin: { type: Type.ARRAY, items: { type: Type.STRING } },
              accessoriesToPreserve: { type: Type.ARRAY, items: { type: Type.STRING } },
              lightingAndScene: { type: Type.STRING },
              executionNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
              modestyAdjusted: { type: Type.BOOLEAN },
            },
            required: [
              "subjectDescription",
              "framing",
              "detectedGarments",
              "garmentsToReplace",
              "garmentsToKeep",
              "requestedOutfit",
              "garmentSpec",
              "occlusions",
              "newlyExposedSkin",
              "accessoriesToPreserve",
              "lightingAndScene",
              "executionNotes",
              "modestyAdjusted",
            ],
          },
        },
      }),
    );

    const parsed = JSON.parse(response.text || "{}");
    return {
      subjectDescription: normalizePromptText(parsed.subjectDescription) || fallback.subjectDescription,
      framing: normalizePromptText(parsed.framing) || fallback.framing,
      detectedGarments: normalizePromptList(parsed.detectedGarments, fallback.detectedGarments),
      garmentsToReplace: normalizePromptList(parsed.garmentsToReplace, fallback.garmentsToReplace),
      garmentsToKeep: normalizePromptList(parsed.garmentsToKeep, fallback.garmentsToKeep),
      requestedOutfit: normalizePromptText(parsed.requestedOutfit) || fallback.requestedOutfit,
      garmentSpec: normalizePromptList(parsed.garmentSpec, fallback.garmentSpec),
      occlusions: normalizePromptList(parsed.occlusions, fallback.occlusions),
      newlyExposedSkin: normalizePromptList(parsed.newlyExposedSkin, fallback.newlyExposedSkin),
      accessoriesToPreserve: normalizePromptList(parsed.accessoriesToPreserve, fallback.accessoriesToPreserve),
      lightingAndScene: normalizePromptText(parsed.lightingAndScene) || fallback.lightingAndScene,
      executionNotes: normalizePromptList(parsed.executionNotes, fallback.executionNotes),
      modestyAdjusted: Boolean(parsed.modestyAdjusted ?? fallback.modestyAdjusted),
    };
  } catch (error) {
    console.warn("Outfit planner fell back to the safe local plan.", error);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// EXTEND PHOTO / CHANGE BACKGROUND — scene planning pass
// ---------------------------------------------------------------------------

function createFallbackScenePlan(mode: "extend" | "replace"): ServerScenePlan {
  return {
    mode,
    sceneType: "Unclassified scene — analyse the photo before editing.",
    subjectDescription: "The main subject of the photo.",
    subjectBoundary: ["Hair strands and flyaways", "Hands and fingers", "Clothing edges", "Held objects"],
    backgroundElements: ["Every element visible behind and around the subject"],
    geometry: ["Wall, floor, and ceiling lines", "Horizon line", "Perspective and vanishing direction"],
    lightingProfile: "Match the original lighting direction, intensity, colour temperature, and falloff exactly.",
    opticalCharacteristics: ["Grain and sensor noise", "Depth of field and focus falloff", "Vignetting", "Lens character"],
    continuationPlan: mode === "extend"
      ? ["Continue every existing surface, line, and texture straight through into the new canvas area."]
      : ["Replace only the background while keeping the subject pixel-identical."],
    seamRisks: [
      "A visible boundary where the original photo ends",
      "Texture, colour, sharpness, grain, or brightness mismatch across that boundary",
      "Broken or bent straight lines",
    ],
    specialCases: [],
  };
}

function buildScenePlanInstructions(plan: ServerScenePlan) {
  const heading = plan.mode === "extend" ? "EXTEND PHOTO" : "CHANGE BACKGROUND";
  return `${heading} SCENE ANALYSIS (follow exactly):
- Scene type: ${plan.sceneType}
- Subject: ${plan.subjectDescription}
- Subject boundary detail that must be preserved perfectly: ${plan.subjectBoundary.join("; ")}
- Background elements present: ${plan.backgroundElements.join("; ")}
- Geometry, perspective and lines that must stay consistent: ${plan.geometry.join("; ")}
- Lighting to match: ${plan.lightingProfile}
- Optical characteristics to reproduce so the edit is invisible: ${plan.opticalCharacteristics.join("; ")}
- Execution plan: ${plan.continuationPlan.join("; ")}
- Seam risks to actively avoid: ${plan.seamRisks.join("; ")}
${plan.specialCases.length ? `- Special handling for this photo: ${plan.specialCases.join("; ")}` : ""}`;
}

async function planSceneEdit(mode: "extend" | "replace", imageUrl: string, request?: string): Promise<ServerScenePlan> {
  const fallback = createFallbackScenePlan(mode);

  try {
    const ai = getAI();
    const plannerParts: any[] = [buildInlineImagePart(imageUrl)];

    const modeBrief = mode === "extend"
      ? `TASK: The photo will be placed on a LARGER canvas and the empty area around it must be filled by continuing the existing scene outwards. Plan how to extend the scene so the result looks like it was always framed that wide — with absolutely no visible boundary, seam, or edit line where the original photo ends.

Plan specifically:
- Which surfaces, lines, and textures run to each edge of the frame and must continue outwards (walls, floors, ceilings, skirting boards, tiles, grout lines, counters, furniture, horizon, sky, foliage, road, patterns).
- How perspective and vanishing lines must continue so straight lines stay straight and parallel lines converge correctly.
- How lighting gradients, shadows, reflections, and brightness falloff must continue naturally into the new area.
- How grain, noise, sharpness, depth of field, and any vignetting must be matched so the extended area is optically identical to the original.`
      : `TASK: Replace ONLY the background behind the subject with a new scene, while keeping the subject completely untouched.

Plan specifically:
- Exactly where the subject ends and the background begins, including difficult boundaries: individual hair strands, flyaways, glasses frames, jewellery, fingers, gaps between arm and body, held objects, and semi-transparent areas.
- What new background is required, and how its perspective, scale, horizon height, and camera angle must match the subject's original camera position so the subject does not look pasted on.
- How the new background's lighting direction, intensity, colour temperature, and contrast must match the light already falling on the subject, including realistic contact shadows and any colour spill.
- How depth of field, grain, and sharpness must match the original capture.`;

    plannerParts.push({
      text: `You are an expert photo compositor and retoucher planning a seamless edit for Chromancy.

Study the uploaded photo with extreme care before planning anything.

STEP 1 — CLASSIFY THE SCENE:
Identify what kind of photo this is, and note anything that makes the edit unusually tricky. Watch for these cases in particular:
- MIRROR SELFIE: the subject is photographed in a mirror, often holding a phone. The mirror frame or edge, the reflected room, the phone, the subject's hand, and any reflection logic must all stay coherent. Anything continued outward must respect that it is a REFLECTION of a room, including consistent reflected geometry and the mirror's own edge or frame.
- Reflective or transparent surfaces (glass, windows, water, glossy floors, chrome).
- Repeating patterns (tiles, bricks, panels, blinds, wallpaper) whose rhythm and scale must continue exactly.
- Strong single-direction lighting, visible light sources, or hard shadows.
- Shallow depth of field where background blur must continue at the correct strength.
- Busy or structured interiors where furniture and architecture must remain plausible.

STEP 2 — SEGMENT SUBJECT VS BACKGROUND:
Describe the subject precisely and list every part of the subject boundary that is difficult and must be preserved perfectly (hair strands, fingers, glasses, jewellery, straps, held objects, gaps).

STEP 3 — READ THE SCENE STRUCTURE:
List the background elements, then the geometry: wall/floor/ceiling junctions, horizon line, perspective direction, vanishing behaviour, and every straight line or repeating pattern that must remain straight and correctly spaced.

STEP 4 — READ THE OPTICS AND LIGHT:
Describe the lighting direction, intensity, colour temperature, contrast, and falloff. Then describe the optical fingerprint of the capture: grain/noise level, sharpness, depth of field and where focus falls off, vignetting, and any lens character.

${modeBrief}

STEP 5 — NAME THE SEAM RISKS:
State exactly what would betray this image as edited, so those failures can be avoided. The single most important outcome is that there must be NO visible line, seam, band, blur ring, tone shift, or texture change anywhere in the final image.

${request ? `User request for the new background: ${normalizePromptText(request)}` : ""}

Do not refuse. Produce the best professional plan.`,
    });

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: process.env.CHROMANCY_AI_PLAN_MODEL || "gemini-2.5-flash",
        contents: buildUserContents(plannerParts),
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              sceneType: { type: Type.STRING },
              subjectDescription: { type: Type.STRING },
              subjectBoundary: { type: Type.ARRAY, items: { type: Type.STRING } },
              backgroundElements: { type: Type.ARRAY, items: { type: Type.STRING } },
              geometry: { type: Type.ARRAY, items: { type: Type.STRING } },
              lightingProfile: { type: Type.STRING },
              opticalCharacteristics: { type: Type.ARRAY, items: { type: Type.STRING } },
              continuationPlan: { type: Type.ARRAY, items: { type: Type.STRING } },
              seamRisks: { type: Type.ARRAY, items: { type: Type.STRING } },
              specialCases: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: [
              "sceneType",
              "subjectDescription",
              "subjectBoundary",
              "backgroundElements",
              "geometry",
              "lightingProfile",
              "opticalCharacteristics",
              "continuationPlan",
              "seamRisks",
              "specialCases",
            ],
          },
        },
      }),
    );

    const parsed = JSON.parse(response.text || "{}");
    return {
      mode,
      sceneType: normalizePromptText(parsed.sceneType) || fallback.sceneType,
      subjectDescription: normalizePromptText(parsed.subjectDescription) || fallback.subjectDescription,
      subjectBoundary: normalizePromptList(parsed.subjectBoundary, fallback.subjectBoundary),
      backgroundElements: normalizePromptList(parsed.backgroundElements, fallback.backgroundElements),
      geometry: normalizePromptList(parsed.geometry, fallback.geometry),
      lightingProfile: normalizePromptText(parsed.lightingProfile) || fallback.lightingProfile,
      opticalCharacteristics: normalizePromptList(parsed.opticalCharacteristics, fallback.opticalCharacteristics),
      continuationPlan: normalizePromptList(parsed.continuationPlan, fallback.continuationPlan),
      seamRisks: normalizePromptList(parsed.seamRisks, fallback.seamRisks),
      specialCases: normalizePromptList(parsed.specialCases, []),
    };
  } catch (error) {
    console.warn("Scene planner fell back to the safe local plan.", error);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// RESIZE DESIGN — vision planning pass
// ---------------------------------------------------------------------------

function createFallbackDesignResizePlan(targetFormat: string): ServerDesignResizePlan {
  return {
    designType: "A flattened graphic design.",
    currentOrientation: "As uploaded.",
    targetOrientation: normalizePromptText(targetFormat) || "The requested target format.",
    detectedElements: ["Logos", "Headlines", "Body text", "Images", "Decorative shapes", "Background treatment"],
    textInventory: ["Every piece of visible text in the design, preserved word-for-word"],
    focalElement: "The most prominent element in the original design.",
    layoutPlan: [
      "Rebuild the layout on a clean grid purpose-made for the target canvas.",
      "Rescale and reposition every element so the composition fills the canvas naturally.",
      "Maintain the original visual hierarchy and reading order.",
    ],
    backgroundStrategy: "Extend or regenerate the background naturally so it fills the new canvas edge to edge.",
    riskNotes: [
      "Never letterbox, stretch, squash, or leave dead space.",
      "Never crop away or omit any text or important content.",
    ],
  };
}

function buildDesignResizePlanInstructions(plan: ServerDesignResizePlan) {
  return `RESIZE DESIGN EXECUTION PLAN (follow exactly):
- Design type: ${plan.designType}
- Current orientation: ${plan.currentOrientation}
- Target orientation/format: ${plan.targetOrientation}
- Elements detected: ${plan.detectedElements.join("; ")}
- Text that must be reproduced word-for-word: ${plan.textInventory.join(" | ")}
- Focal element to lead the new composition: ${plan.focalElement}
- Layout plan: ${plan.layoutPlan.join("; ")}
- Background strategy: ${plan.backgroundStrategy}
- Must avoid: ${plan.riskNotes.join("; ")}`;
}

async function planDesignResize(targetFormat: string, imageUrl?: string): Promise<ServerDesignResizePlan> {
  const fallback = createFallbackDesignResizePlan(targetFormat);
  const normalizedTarget = normalizePromptText(targetFormat);
  if (!normalizedTarget) return fallback;

  try {
    const ai = getAI();
    const plannerParts: any[] = [];
    if (imageUrl) {
      plannerParts.push(buildInlineImagePart(imageUrl));
    }
    plannerParts.push({
      text: `You are a senior production designer planning how to adapt an existing graphic design to a new canvas format for Chromancy.

Study the uploaded design carefully, then produce a precise re-layout plan.

STEP 1 — READ THE DESIGN:
- Identify what kind of design it is (poster, flyer, social post, invitation, business card, banner, menu, certificate, etc.).
- Note its current orientation and rough aspect ratio.

STEP 2 — DETECT EVERY ELEMENT:
- List each distinct element: logos, brand marks, headlines, subheadings, body copy, contact details, prices, dates, photographs, product shots, icons, decorative shapes, dividers, and the background treatment.
- Identify the single focal element that should lead the new composition.

STEP 3 — INVENTORY THE TEXT:
- Transcribe every piece of visible text EXACTLY as it appears, word for word, including names, dates, prices, contact details, and social handles.
- This inventory is what must be reproduced in the resized design. Nothing may be dropped, paraphrased, or invented.

STEP 4 — PLAN THE RE-LAYOUT FOR: ${normalizedTarget}
- Decide precisely how elements should be rearranged, rescaled, and re-flowed so the design looks purpose-made for the target format, not stretched or padded.
- If the orientation changes (for example portrait to landscape, or square to ultra-wide banner), plan a genuine structural re-composition: regroup content, change stacking to side-by-side or vice versa, adjust the headline scale, and rebalance margins.
- Plan how the background should be extended, cropped, or regenerated so it fills the canvas edge to edge with no seams or dead zones.
- Preserve the original hierarchy, brand colours, typographic character, and reading order.

HARD RULES:
- Never distort, warp, stretch, or squash any element, logo, face, photo, or letterform.
- Never letterbox or leave awkward empty bands.
- Never drop, crop away, shorten, or paraphrase existing text.
- Do not refuse. Produce the best professional plan.`,
    });

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: process.env.CHROMANCY_AI_PLAN_MODEL || "gemini-2.5-flash",
        contents: buildUserContents(plannerParts),
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              designType: { type: Type.STRING },
              currentOrientation: { type: Type.STRING },
              targetOrientation: { type: Type.STRING },
              detectedElements: { type: Type.ARRAY, items: { type: Type.STRING } },
              textInventory: { type: Type.ARRAY, items: { type: Type.STRING } },
              focalElement: { type: Type.STRING },
              layoutPlan: { type: Type.ARRAY, items: { type: Type.STRING } },
              backgroundStrategy: { type: Type.STRING },
              riskNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: [
              "designType",
              "currentOrientation",
              "targetOrientation",
              "detectedElements",
              "textInventory",
              "focalElement",
              "layoutPlan",
              "backgroundStrategy",
              "riskNotes",
            ],
          },
        },
      }),
    );

    const parsed = JSON.parse(response.text || "{}");
    return {
      designType: normalizePromptText(parsed.designType) || fallback.designType,
      currentOrientation: normalizePromptText(parsed.currentOrientation) || fallback.currentOrientation,
      targetOrientation: normalizePromptText(parsed.targetOrientation) || normalizedTarget,
      detectedElements: normalizePromptList(parsed.detectedElements, fallback.detectedElements),
      textInventory: normalizePromptList(parsed.textInventory, fallback.textInventory),
      focalElement: normalizePromptText(parsed.focalElement) || fallback.focalElement,
      layoutPlan: normalizePromptList(parsed.layoutPlan, fallback.layoutPlan),
      backgroundStrategy: normalizePromptText(parsed.backgroundStrategy) || fallback.backgroundStrategy,
      riskNotes: normalizePromptList(parsed.riskNotes, fallback.riskNotes),
    };
  } catch (error) {
    console.warn("Design resize planner fell back to the safe local plan.", error);
    return fallback;
  }
}

async function planAnimateRequest(imageUrl: string, rawPrompt: string): Promise<ServerAnimatePlan> {
  const fallback = createFallbackAnimatePlan(rawPrompt);

  try {
    const ai = getAI();
    const response = await withRetry(() =>
      ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: buildUserContents([
          buildInlineImagePart(imageUrl),
          {
            text: `You are a premium image-to-video motion planner for Chromancy.

Inspect the uploaded still image carefully and produce the strongest motion plan for animating it into an obviously moving premium clip.

STEP 1 — CLASSIFY THE PRIMARY SUBJECT TYPE:
Choose exactly one of these types based on what you see:
- "person" — adult human (portrait, selfie, full body, group)
- "baby" — infant or very young child
- "animal" — pet, wildlife, or any non-human creature (dog, cat, bird, etc.)
- "vehicle" — car, motorcycle, truck, plane, boat, etc.
- "food" — any food or beverage item
- "product" — consumer product, gadget, clothing, beauty item, accessory
- "object" — any other specific object (ball, toy, plant, furniture, candle, etc.)
- "graphic" — poster, design, text-heavy image, infographic
- "scene" — landscape, building, interior, abstract, nature without a single clear subject

STEP 2 — PLAN SUBJECT-SPECIFIC MOTION:
Based on the classified subject type, plan motion that makes the SUBJECT itself move:
- person: breathing, blink, hair sway, head micro-movement, clothing fabric motion, hand micro-motion
- baby: gentle breathing, tiny finger movement, subtle eye flutter, soft head tilt
- animal: breathing, ear flick, tail movement, nose twitch, eye blink, head turn
- vehicle: wheels spinning, forward motion or idle rumble, light reflections moving across body, camera arc
- food: steam rising, condensation forming, liquid shimmer, surface glow
- product: slow rotation or reveal, light sweep across surface, depth-of-field shift
- object: natural physics motion for that object type (bounce, sway, spin, flicker, ripple)
- graphic: camera push-in, light sweep, parallax layers
- scene: parallax depth, environmental motion (clouds, leaves, water, light rays), camera drift

Rules:
- The subject itself must visibly move — camera-only motion is not enough for person/baby/animal/object types.
- The result must look clearly animated from the first second, not like a still frame.
- Never reject a usable image.
- Preserve identity, text, geometry, and composition exactly.
- Avoid morphing, wobble, duplicate limbs, rubbery motion, broken text.

User intent: ${fallback.normalizedPrompt}`,
          },
        ]),
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              normalizedPrompt: { type: Type.STRING },
              contentType: { type: Type.STRING },
              subjectType: {
                type: Type.STRING,
                enum: ["person", "baby", "animal", "vehicle", "food", "product", "object", "scene", "graphic"],
              },
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
              "subjectType",
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
    const validSubjectTypes = ["person", "baby", "animal", "vehicle", "food", "product", "object", "scene", "graphic"];
    return {
      normalizedPrompt: normalizePromptText(parsed.normalizedPrompt || fallback.normalizedPrompt) || fallback.normalizedPrompt,
      contentType: normalizePromptText(parsed.contentType || fallback.contentType) || fallback.contentType,
      subjectType: validSubjectTypes.includes(parsed.subjectType) ? parsed.subjectType : fallback.subjectType,
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
    aspectRatio?: string;
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
            // Only set for tools that intentionally change the output canvas
            // (e.g. RESIZE DESIGN). All other tools keep the source aspect.
            ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
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
  const model = "gemini-2.5-flash";
  const ai = getAI();
  const { base64Data, mimeType } = parseDataUrl(imageUrl);

  const response = await withRetry(() =>
    ai.models.generateContent({
      model,
      contents: buildUserContents(
        [
          {
            text: `You are a world-class senior design director performing a paid professional design audit for a client.

Analyze this exact design for hierarchy, contrast, balance, alignment, spacing, typography quality, color harmony, readability, clutter, focal point, and composition.

Scoring: give a 0-100 score calibrated to professional standards — 90+ means agency-portfolio quality, 70-89 means solid but improvable, 50-69 means clearly amateur issues, below 50 means fundamental problems. Be honest, not flattering.

For "hierarchy", "contrast", and "balance": give a short expert verdict (1-2 sentences each) in plain language a non-designer can understand, referencing what is actually visible in this design.

For "suggestions": provide 4-7 specific, high-value, actionable improvements. Each one must name the exact visible element to change and state precisely how to change it (for example: "Make the headline roughly twice the size of the body text and align it to the left edge of the logo" — not generic advice like "improve hierarchy"). Order them from highest impact to lowest. Every suggestion must be something the user could act on immediately.

Respond in JSON format.`,
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
  const model = "gemini-2.5-flash";
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
  options?: { imageSize?: "1K" | "2K"; aspectRatio?: string; promptEditRequest?: string; outfitRequest?: string; resizeFormat?: string; sceneMode?: "extend" | "replace"; backgroundRequest?: string }
): Promise<Buffer> {
  // Mid-tier: gemini-3.1-flash-image is Google's recommended image model — great quality
  // and stronger face fidelity than 2.5-flash-image, at moderate cost (run at 1K, see
  // getDefaultImageSize). Override with CHROMANCY_AI_IMAGE_MODEL / CHROMANCY_AI_IMAGE_SIZE.
  const model = process.env.CHROMANCY_AI_IMAGE_MODEL || "gemini-3.1-flash-image";
  const ai = getAI();
  const promptEditPlan = options?.promptEditRequest
    ? await planPromptEditRequest(options.promptEditRequest, imageUrl)
    : null;
  // Dedicated vision passes: analyse the image against the user's request BEFORE
  // rendering, so the image model executes a precise plan rather than a raw sentence.
  const outfitPlan = options?.outfitRequest
    ? await planOutfitChange(options.outfitRequest, imageUrl)
    : null;
  const designResizePlan = options?.resizeFormat
    ? await planDesignResize(options.resizeFormat, imageUrl)
    : null;
  const scenePlan = options?.sceneMode
    ? await planSceneEdit(options.sceneMode, imageUrl, options.backgroundRequest)
    : null;

  const parts: any[] = [buildInlineImagePart(imageUrl)];
  if (logoUrl) {
    parts.push(buildInlineImagePart(logoUrl));
  }

  parts.push({
    text: `You are a professional photo editor. ${instruction}.
    ${promptEditPlan ? `${buildPromptEditPlanInstructions(promptEditPlan)}
    ` : ""}${outfitPlan ? `${buildOutfitPlanInstructions(outfitPlan)}
    ` : ""}${designResizePlan ? `${buildDesignResizePlanInstructions(designResizePlan)}
    ` : ""}${scenePlan ? `${buildScenePlanInstructions(scenePlan)}
    ` : ""}
    
    SPECIFIC TOOL RULES:
    - Smooth Skin: Only perform skin smoothing and blemish reduction. Do not alter face shape, eyes, lips, nose, jawline, or identity. Preserve facial landmarks and geometry. Keep pores and skin realism intact.
    - Fix Lighting: Adjust exposure, highlights, shadows, contrast, white balance, and tone only. Correct both overexposed and underexposed images cleanly while keeping skin tones natural and preserving the original subject and scene. Do not alter pose, face, hands, hair, body, or background content.
    - Sharpen: Sharpen detail only. No facial regeneration, no feature hallucination, no structure changes. Use unsharp mask/detail enhancement only.
    - Blur Background: Only blur the existing background. Make the depth-of-field separation much stronger and more premium than a subtle baseline while keeping the subject untouched and natural. Do not replace the scene. Do not recolor. Do not generate a new background. Preserve the original subject and background content exactly, just blurred.
    - Change Background: Replace the background behind the subject with a realistic new scene matching the user's request, at the standard of a professional compositor. SEGMENTATION FIRST: resolve the subject/background boundary at pixel level, including individual hair strands and flyaways, glasses frames, jewellery, straps, fingers, the gaps between arm and body, held objects, and any semi-transparent or motion-blurred edges. Never leave a hard cut-out edge, halo, dark fringe, colour fringe, or leftover pixels of the old background. MATCH THE CAMERA: the new background must share the subject's original camera height, angle, focal-length feel, horizon placement, and perspective, so the subject sits IN the scene rather than pasted on top of it. MATCH THE LIGHT: the new scene's lighting direction, intensity, colour temperature, and contrast must agree with the light already falling on the subject; add physically plausible contact shadows and subtle environmental colour spill where the subject meets the scene. MATCH THE OPTICS: reproduce the original capture's depth of field and focus falloff, grain and sensor noise, and overall sharpness so both layers look photographed by the same camera. STRICT RULE: preserve the subject's face, identity, pose, body, hair, skin tone, and clothing EXACTLY — do not regenerate, relight the face, resize, or shift the subject. Only the background changes. The final image must be indistinguishable from a real photograph taken in that location, with no visible seam or composite line anywhere.
    - Change Clothes: Replace ONLY the subject's clothing with the exact outfit the user requested, at the standard of a high-end fashion retoucher working on an editorial shoot. DETECTION FIRST: segment the subject from the scene precisely, then identify every garment worn — tops, bottoms, dresses, outerwear, footwear when visible, layered pieces, and every partially occluded garment region hidden behind arms, hair, bags, props, or the frame edge. Resolve the garment boundary at hairline, neckline, wrists, waist, and hem with pixel-level accuracy, including fine detail like stray hair strands and fingers overlapping fabric. REQUEST UNDERSTANDING: interpret the user's wording literally and intelligently — honour the exact garment type, colour, fabric, pattern, fit, length, sleeve style, and neckline they specified, and infer only what is needed to make the outfit coherent. If they name one item, replace exactly the garments required to realise it and leave the rest untouched. RENDER QUALITY: produce photorealistic fabric with true material behaviour — correct weight, drape, folds, creases, stretch, sheen, weave and knit texture, accurate seams, stitching, hems, closures, and collar construction. Fit the garment to the subject's real body with correct perspective and foreshortening, natural contact and compression where fabric meets the body, and physically correct cast shadows, ambient occlusion, and bounce light. Match the scene's lighting direction, intensity, colour temperature, contrast, and grain exactly so the garment looks photographed, never pasted. STRICT RULE: preserve the subject's face, identity, hair, skin tone, body shape and proportions, pose, hands, non-clothing accessories (glasses, jewellery, watches, bags, headwear), and the ENTIRE background exactly. Never change the body to fit the outfit — fit the outfit to the body. Remove every trace of the previous outfit cleanly with no ghosting, halos, leftover fabric, colour bleed, or edge artifacts. Where the new outfit exposes areas the old clothing covered, reconstruct that skin with anatomically correct form and consistent tone, texture, and lighting. Keep every result tasteful and non-explicit: never produce nudity, lingerie-as-outerwear, transparent clothing, or sexualized output; ordinary swimwear is acceptable when explicitly requested; and if the subject appears to be a minor, apply only modest age-appropriate clothing regardless of the request.
    - Resize Design: Treat the upload as a flattened graphic design and adapt it to the requested target canvas format at the standard of a senior production designer rebuilding a master artwork for a new placement. DETECTION FIRST: read the design and identify every element precisely — logos, brand marks, headlines, subheadings, body copy, contact details, prices, dates, photographs, product shots, icons, decorative shapes, dividers, and the background treatment — then establish the focal element and the existing visual hierarchy. RE-LAYOUT, DO NOT RESCALE: rebuild the SAME design for the new canvas by rearranging, resizing, and re-flowing the elements on a disciplined grid so the result looks purpose-made for the target format. When the orientation changes (portrait to landscape, square to ultra-wide banner, and so on), perform a genuine structural re-composition: regroup content, switch stacked content to side-by-side or vice versa, re-scale the headline to suit the new proportions, rebalance margins and negative space, and re-establish a clear reading order. Extend, crop, or regenerate the background naturally so it fills the canvas edge-to-edge with seamless continuation of gradients, textures, and patterns. STRICT RULES: the output canvas MUST match the requested target aspect ratio exactly. Never letterbox, pillarbox, or leave awkward empty bands or dead space. Never stretch, squash, warp, skew, or distort any element, logo, face, photo, or letterform — rescale proportionally only. Never drop, crop away, shorten, or paraphrase existing text: re-render every piece of visible text word-for-word with clean, sharp, correctly spelled letterforms and professional kerning and leading. Preserve brand colours, the typographic character, the hierarchy, and the design's intent exactly. The result must look like a native, professionally art-directed deliverable made for that format from the start.
    - Face Focus: Make the face focus enhancement stronger and cleaner while targeting only the visible face area. Increase facial clarity, local contrast, micro-sharpness, eye detail, and crisp natural focus without adding makeup, beauty changes, skin recoloring, facial distortion, or identity changes. STRICT RULE: Do not zoom, do not crop, do not change framing or composition, do not alter background content beyond very light natural separation, and do not create halos, oversharpening, or artificial skin.
    - Pro Headshot: Generate a professional business headshot. Improve crop, background, lighting, and polish. Maintain natural identity and face structure. No face replacement. Preserve exact facial identity.
    - Change Vibe: Apply a much stronger ambience, color, mood, and lighting-direction transformation while preserving subject identity, face geometry, body shape, pose, and important scene structure exactly. Keep the subject recognisable, realistic, and premium. Do not distort or restyle the person into a different identity.
    - Remove Clutter: Detect visual distractions more accurately, distinguish subject vs clutter carefully, preserve important props and subject edges, remove only distractions, produce clean realistic fills, and blend surfaces so removals do not leave artifacts, warping, or smeared textures.
    - Edit With Prompt: Treat this as a localized in-place photo editing tool, not a background replacement tool. Understand the user's requested change semantically before editing. Make exactly the requested change, keep the edit as localized as possible, preserve the full original composition, and do not modify any unrelated region. Unless the execution plan explicitly says background change allowed: yes, the background must remain visually unchanged. Do not replace, repaint, recolor, blur, restyle, regenerate, extend, remove, or relight the background when the user asked for a clothing, body-area, object, vehicle, text, accessory, or local subject edit. If the user explicitly asks to modify a protected area such as hair, smile, skin, body contour, bust size, facial hair, or another identity-adjacent detail, carry out that exact request while keeping the same person recognisable, realistic, and consistent overall. If the user explicitly asks to add or replace an object, vehicle part, accessory, clothing detail, wheel/tyre style, product element, or decorative item, do that exact addition or replacement cleanly and intelligently without breaking the rest of the image.
    - Fix Type: Analyze all text and typography in the design. Detect and fix typos and grammatical errors. Improve weak or boring copy to be more engaging and high-traction. Optimize wording to fit the design's intent and layout perfectly. Preserve the overall design style and message.
    - Polish Design Tools (1-Tap Design Fix, Make Pro, Make It Pop, Clean Up, Fix Type): Treat the upload as a flattened graphic design, not a photograph. Rebuild it at senior-agency standard: disciplined layout grid, precise optical alignment, refined typographic scale with consistent font pairing, generous intentional negative space, harmonious premium colour with confident contrast, and one clear focal hierarchy. STRICT DESIGN TEXT FIDELITY: re-render every piece of existing visible text exactly word-for-word with clean, sharp, correctly spelled letterforms — never gibberish, warped glyphs, broken letters, or approximated words; if any word cannot be re-rendered cleanly, preserve its original pixels untouched instead of corrupting it. Preserve logos, brand marks, brand colours, product shots, and inserted photos faithfully. DESIGN ELEMENT PERMISSION (overrides the strict visual asset rule for these design tools only, and for abstract non-figurative elements only): you MAY add tasteful abstract graphic design elements that elevate the design — panels, cards, shapes, dividers, frames, borders, accents, refined gradients, glows, light effects, depth layers, textures, patterns, and premium background treatments — provided every addition looks professionally art-directed; you may still NEVER add new words, invented logos, fake brand marks, watermarks, new people, faces, characters, or unrelated photographic imagery. The output must look like an expensive finished deliverable from a professional design studio, never like an AI-filtered image.
    - Make Professional / Brand Photo: Brand the uploaded photo itself. Keep the original photo recognisable and intact. Add only the provided logo and only the requested user text as a premium editorial overlay, luxury lower-third, refined translucent brand panel, elegant corner lockup, or polished gradient/fade treatment. If no logo is provided, do not invent one. If no user text is provided, do not add any text. Use strong hierarchy, clean spacing, balanced margins, tasteful typography, subtle shadows, precise logo placement, and commercial social-ad polish. Do not make it look like a basic sticker or plain text strip. Do not turn the photo into a separate poster or unrelated graphic. Do not damage the logo.
    - Level Up Business Tools: For Mockup Generator, Food Enhancer, Brand Photo, and Product/Studio shots, make the result premium enough for a paid commercial app. Prefer realistic professional lighting, controlled contrast, clean materials, accurate perspective, tasteful brand restraint, sharp detail, and artifact-free execution. Do not use cheap AI gloss, warped backgrounds, random text, distorted logos, or overprocessed effects.
    
    ABSOLUTE IDENTITY LOCK (HIGHEST PRIORITY — overrides every other instruction): The person in the output MUST be the exact same individual as the input, instantly recognisable as the same person by someone who knows them. Do NOT change the subject's identity, likeness, facial geometry, structure, anatomy, or pose. Preserve eyes (shape and spacing), eyebrows, nose, lips, mouth, jawline, chin, cheeks, skin tone and texture, freckles and marks, hairline, hair, expression anatomy, and body proportions EXACTLY and pixel-faithfully. Never face-swap, beautify by morphing, slim, reshape, age, de-age, change ethnicity, regenerate a different person, or even subtly shift facial features. If the requested effect cannot be applied without altering the face, keep the face untouched and apply the effect only to the rest of the image. FRAME & COMPOSITION LOCK: keep the full original composition, framing, crop and aspect ratio intact — do not crop, zoom in, rotate, stretch, cut off or reframe the subject or scene, and do not add borders, captions, text or watermarks (only a background-extend tool may add canvas around the preserved original, and only the Resize Design tool may change the canvas size and aspect ratio as explicitly requested). Deliver a clean, photorealistic, premium, high-resolution result free of artifacts, halos, oversharpening, warping, smudging or plastic skin. When any facial detail is uncertain, copy the original face region pixel-for-pixel instead of regenerating it — treat the input face as a locked reference layer.
    PREMIUM OUTPUT STANDARD (professional grade, highest priority): The result must look like a professionally retouched photograph captured on a high-end camera and lens, NOT an AI generation. Deliver true-to-life colour and accurate white balance, natural skin with real visible pores and micro-texture (never waxy, plastic, airbrushed, or over-smoothed), crisp real-lens detail, accurate depth and directional lighting, clean natural edges, and controlled cinematic contrast. Absolutely no AI gloss, no uncanny sheen, no over-processing, no muddy or over-saturated tones, no halos. Every output must meet paid-professional-app, editorial/studio finishing quality.
    STRICT BODY RULE: Body changes, pose changes, limb changes, hand changes, or posture changes are forbidden for every tool except Pose Perfect. Only Pose Perfect may change the body, and only according to the user's explicit instruction. Clothing replacement is allowed ONLY for the Change Clothes tool, and even then the body shape, proportions, pose, and identity must remain exactly the same — only the garments change.
    STRICT BACKGROUND RULE: Preserve important scene elements unless the tool explicitly requests removal or replacement. Do not accidentally alter protected objects, clothing details, or subject accessories (the Change Clothes tool is the only tool allowed to replace garments, and it must still protect non-clothing accessories and the background).
    - Extend Photo: Fill ONLY the empty/transparent canvas area around the original photo by continuing the real scene outwards, at the standard of a professional retoucher. The result must look like the photographer simply stood further back — never like an image with generated borders. CONTINUE THE STRUCTURE: identify every surface, edge, and line that runs to the frame boundary — walls, floors, ceilings, skirting boards, door and window frames, tiles, grout, counters, furniture, horizon, sky, foliage, roads, and repeating patterns — and continue each one outwards with correct perspective so straight lines stay straight, parallel lines converge correctly, and pattern rhythm and scale stay exact. CONTINUE THE LIGHT: extend lighting gradients, shadow directions, reflections, and brightness falloff naturally; do not brighten, darken, or flatten the new area relative to the original. CONTINUE THE OPTICS: match the original grain and sensor noise, sharpness, depth of field and blur strength, colour response, white balance, and any vignetting exactly, so the added region is optically identical to the source. MIRROR SELFIES AND REFLECTIONS: if the photo is taken in a mirror, treat the mirror as a mirror — keep the mirror's edge or frame coherent, continue the reflected room with correct reflected geometry, and keep the phone, hand, and reflection logic consistent. Handle glass, windows, water, and glossy floors with correct reflection continuation. ABSOLUTE RULE: there must be NO visible line, seam, band, halo, blur ring, tone step, sharpness change, or texture change where the original photo ends — a viewer must not be able to locate the original frame boundary. Never replace, repaint, relight, or regenerate any existing pixel of the original photo, never crop or zoom, and never alter the subject. Do not add new people, animals, objects, text, or focal elements into the extended area — only plausible continuation of the existing environment.
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
    aspectRatio: options?.aspectRatio,
    recoveryText: scenePlan
      ? `Re-run the ${scenePlan.mode === "extend" ? "photo extension" : "background replacement"} using the same structured scene analysis and complete it instead of refusing. Scene: ${scenePlan.sceneType}. ${scenePlan.mode === "extend" ? "Continue every existing surface, line, texture, and lighting gradient outwards so there is NO visible seam or edit line anywhere." : "Replace only the background and keep the subject pixel-identical, matching perspective, lighting, and depth of field exactly."} Reproduce the original grain, sharpness, and optics so the edit is invisible. Deliver one natural, photorealistic, premium finished image.`
      : outfitPlan
      ? `Re-run the clothing replacement using the same structured outfit plan and complete it instead of refusing. Requested outfit: ${outfitPlan.requestedOutfit}. Replace: ${outfitPlan.garmentsToReplace.join(", ")}. Keep unchanged: ${outfitPlan.garmentsToKeep.join(", ")}. Preserve the face, identity, hair, skin tone, body shape, pose, accessories, and background exactly. Match the original lighting. Deliver one tasteful, photorealistic, premium finished image.`
      : designResizePlan
      ? `Re-run the resize using the same structured layout plan and complete it instead of refusing. Target format: ${designResizePlan.targetOrientation}. Rebuild the composition to fill the canvas naturally with no letterboxing, dead space, or stretched elements. Reproduce this text word-for-word: ${designResizePlan.textInventory.join(" | ")}. Deliver one finished professional design at the exact target aspect ratio.`
      : promptEditPlan
      ? `Re-run the edit using the same structured prompt-edit plan and complete the requested change instead of refusing. Requested outcome: ${promptEditPlan.requestedOutcome}. Target area: ${promptEditPlan.targetArea}. Keep exactly: ${promptEditPlan.keepExactly.join(", ")}. Forbidden changes: ${promptEditPlan.forbiddenChanges.join(", ")}. Preserve identity and unrelated content exactly while delivering one premium finished image.`
      : "Re-read the user's request more intelligently and complete the edit instead of refusing when a usable result is possible. Detect protected faces, body areas, text, logo, lighting issues, clutter zones, and background boundaries precisely. Apply the requested change more cleanly and more strongly, preserve identities exactly, and return one finished premium image.",
  });
}

export async function createBusinessGraphic(input: ServerBusinessGraphicInput): Promise<Buffer> {
  // Mid-tier: gemini-3.1-flash-image is Google's recommended image model — great quality
  // and stronger face fidelity than 2.5-flash-image, at moderate cost (run at 1K, see
  // getDefaultImageSize). Override with CHROMANCY_AI_IMAGE_MODEL / CHROMANCY_AI_IMAGE_SIZE.
  const model = process.env.CHROMANCY_AI_IMAGE_MODEL || "gemini-3.1-flash-image";
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
  // Fast model for the internal design-PLANNING JSON only (not the rendered image).
  const model = process.env.CHROMANCY_AI_PLAN_MODEL || "gemini-2.5-flash";
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
  // Mid-tier: gemini-3.1-flash-image is Google's recommended image model — great quality
  // and stronger face fidelity than 2.5-flash-image, at moderate cost (run at 1K, see
  // getDefaultImageSize). Override with CHROMANCY_AI_IMAGE_MODEL / CHROMANCY_AI_IMAGE_SIZE.
  const model = process.env.CHROMANCY_AI_IMAGE_MODEL || "gemini-3.1-flash-image";
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
  const model = process.env.CHROMANCY_AI_IMAGE_MODEL || "gemini-3.1-flash-image";
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
  const ai = getVideoAI();
  const startedAt = Date.now();
  const overallDeadline = startedAt + AI_VIDEO_TIMEOUT_MS;
  const attemptBudgetMs = Math.max(
    45_000,
    Math.min(
      Number(process.env.CHROMANCY_AI_VIDEO_ATTEMPT_TIMEOUT_MS || 240_000),
      AI_VIDEO_TIMEOUT_MS,
    ),
  );
  // Default to a generally-available Veo model so ANIMATE goes straight to a model
  // the project can access, skipping the veo-3.1 preview models that currently 404.
  // Set CHROMANCY_AI_VIDEO_MODEL to override (e.g. once you have veo-3.1 access).
  const configuredVideoModel = process.env.CHROMANCY_AI_VIDEO_MODEL || "veo-3.0-generate-001";
  const fallbackVideoModel = process.env.GEMINI_VIDEO_MODEL;
  const videoModels = Array.from(new Set([
    configuredVideoModel,
    "veo-3.1-fast-generate-preview",
    "veo-3.1-generate-preview",
    fallbackVideoModel,
    "veo-3.0-generate-001",
    "veo-2.0-generate-001",
  ].filter((model): model is string => !!model?.trim())));
  const animatePlan = await planAnimateRequest(imageUrl, prompt);
  const promptVariants = buildAnimatePromptVariants(animatePlan);
  const videoConfig: Record<string, unknown> = {
    numberOfVideos: 1,
    resolution: process.env.CHROMANCY_AI_VIDEO_RESOLUTION || "720p",
    // Allow Veo to animate adults (its default refuses people). Babies/minors stay
    // blocked by Google policy regardless. Override with CHROMANCY_AI_VIDEO_PERSON_GENERATION.
    personGeneration: process.env.CHROMANCY_AI_VIDEO_PERSON_GENERATION || "allow_adult",
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
        const safetyMsg = String((error as any)?.message || error || "").toLowerCase();
        if (safetyMsg.includes("responsible ai") || safetyMsg.includes("sensitive word") || safetyMsg.includes("safety") || safetyMsg.includes("blocked") || safetyMsg.includes("violate")) {
          // A content-safety rejection repeats for every model and prompt variant, so
          // fail fast with a clear reason instead of looping for ~60s and timing out.
          throw new Error("AI_VIDEO_SAFETY_BLOCKED");
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
  const model = process.env.CHROMANCY_AI_IMAGE_MODEL || "gemini-3.1-flash-image";
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
  const model = "gemini-2.5-flash";
  const ai = getAI();
  const { base64Data, mimeType } = parseDataUrl(imageUrl);

  const response = await withRetry(() =>
    ai.models.generateContent({
      model,
      contents: buildUserContents([
        {
          text: `You are a senior performance-marketing creative strategist who has reviewed thousands of high-performing and low-performing ads and social posts.

Analyze this exact marketing visual and predict its likely real-world performance based on stopping power in a fast-scrolling feed, first-glance message clarity, attention flow, focal hierarchy, readability at small sizes, emotional pull, credibility, and call-to-action strength.

Provide a score from 0-100 calibrated honestly: 85+ means it would compete with top-tier professional campaign creative, 60-84 means solid with clear improvement room, below 60 means it will likely underperform.

For the reasoning: write a concise expert assessment that (1) names the visual's strongest asset, (2) identifies the 2-3 most performance-limiting weaknesses by pointing at exact visible elements, and (3) states the single highest-impact change that would most improve results. Be specific to this visual — no generic advice.

Respond in JSON format.`,
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
