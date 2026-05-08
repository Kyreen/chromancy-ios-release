import { GoogleGenAI, Type } from "@google/genai";

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

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY || "";
  if (!key.trim()) {
    throw new Error("API_KEY_REQUIRED");
  }
  return key;
}

function getAI() {
  return new GoogleGenAI({ apiKey: getApiKey() });
}

const AI_MODEL_TIMEOUT_MS = Math.max(15_000, Number(process.env.CHROMANCY_AI_MODEL_TIMEOUT_MS || 90_000));
const AI_VIDEO_TIMEOUT_MS = Math.max(AI_MODEL_TIMEOUT_MS, Number(process.env.CHROMANCY_AI_VIDEO_TIMEOUT_MS || 360_000));

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

async function withRetry<T>(fn: () => Promise<T>, retries = 2, delay = 250): Promise<T> {
  try {
    return await withTimeout(fn(), AI_MODEL_TIMEOUT_MS, "AI_REQUEST_TIMEOUT");
  } catch (error: any) {
    const errorString = JSON.stringify(error || {});
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
      message.includes("API_KEY_REQUIRED");

    if (isPermissionError) {
      throw new Error("API_KEY_REQUIRED");
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
        contents: {
          parts,
        },
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
    if (String(error?.message || "").includes("API_KEY_REQUIRED") || isUnsuitableInputError(error)) {
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
      contents: [
        {
          parts: [
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
        },
      ],
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
      contents: [
        {
          parts: [
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
          ],
        },
      ],
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
  options?: { imageSize?: "1K" | "2K" }
): Promise<Buffer> {
  const model = "gemini-3.1-flash-image-preview";
  const ai = getAI();

  const parts: any[] = [buildInlineImagePart(imageUrl)];
  if (logoUrl) {
    parts.push(buildInlineImagePart(logoUrl));
  }

  parts.push({
    text: `You are a professional photo editor. ${instruction}.
    
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
    - Fix Type: Analyze all text and typography in the design. Detect and fix typos and grammatical errors. Improve weak or boring copy to be more engaging and high-traction. Optimize wording to fit the design's intent and layout perfectly. Preserve the overall design style and message.
    - Make Professional / Brand Photo: Brand the uploaded photo itself. Keep the original photo recognisable and intact. Add only the provided logo and only the requested user text as a premium editorial overlay, luxury lower-third, refined translucent brand panel, elegant corner lockup, or polished gradient/fade treatment. If no logo is provided, do not invent one. If no user text is provided, do not add any text. Use strong hierarchy, clean spacing, balanced margins, tasteful typography, subtle shadows, precise logo placement, and commercial social-ad polish. Do not make it look like a basic sticker or plain text strip. Do not turn the photo into a separate poster or unrelated graphic. Do not damage the logo.
    
    STRICT GLOBAL SUBJECT RULE: Do not change the subject's structure, anatomy, pose, identity, likeness, or facial geometry. Preserve eyes, nose, lips, jawline, cheeks, skin texture placement, hairline, expression anatomy, and body proportions exactly. Never face-swap, beautify by morphing, regenerate a different person, or subtly change facial features.
    STRICT BODY RULE: Body changes, pose changes, limb changes, hand changes, or posture changes are forbidden for every tool except Pose Perfect. Only Pose Perfect may change the body, and only according to the user's explicit instruction.
    STRICT BACKGROUND RULE: Preserve important scene elements unless the tool explicitly requests removal or replacement. Do not accidentally alter protected objects, clothing details, or subject accessories.
    STRICT TOOL BOUNDARY RULE: Execute only the requested tool effect. If the request is to extend a background, fill only the missing edge area and do not replace existing background pixels. If the request is to replace a background, change only the background and keep the original subject exactly. If the request is to improve lighting, sharpness, skin, focus, or polish, do not add overlays, new scenery, new props, or decorative elements.
    STRICT TEXT RULE: Do not add text, app names, watermarks, captions, labels, signatures, fake logos, fake contact details, or filler copy unless the selected tool explicitly asks for user-provided text or a user-provided logo. When text is allowed, use only the exact user-provided text and logo assets.
    STRICT VISUAL ASSET RULE: Do not insert unrelated extra images, extra subjects, stickers, icons, decorative objects, fake products, fake people, fake props, or unrelated visual elements that were not supplied by the user, unless a tool explicitly requires a background replacement or a direct requested scene extension.
    DETECTION RULE: Analyze the full image carefully before editing. Detect the main subject, face, body, hands, hair edges, logos, typography, important props, protected objects, background boundaries, clutter regions, lighting problems, and user-requested target area with high precision.
    REQUEST UNDERSTANDING RULE: Interpret the user's tool request literally and intelligently. Infer the most useful premium-quality execution from the request without changing protected identities or protected scene content.
    QUALITY RULE: Keep the result natural, premium, artifact-free, professionally finished, commercially polished, and stronger than a basic edit.
    EXECUTION RULE: Produce the strongest high-quality result that still looks believable and intentional. Avoid cheap-looking effects, weak composition, muddy detail, broken anatomy, warped text, low-end styling, unfinished surfaces, weak edits, and partial changes.
    COMPLETION RULE: If the image is challenging but still possible to edit, produce the best clean premium result rather than refusing. Only return no image when the request is genuinely impossible, unsafe, or the image has no usable visual content.`,
  });

  return generateImageWithRecovery(ai, {
    model,
    parts,
    imageSize: options?.imageSize || getDefaultImageSize(),
    recoveryText: "Re-read the user's request more intelligently and complete the edit instead of refusing when a usable result is possible. Detect protected faces, body areas, text, logo, lighting issues, clutter zones, and background boundaries precisely. Apply the requested change more cleanly and more strongly, preserve identities exactly, and return one finished premium image.",
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

  parts.push({
    text: `You are a premium graphic design generator.
Create one extremely polished professional ${input.useType} using the provided assets and details. This must look like a finished agency-quality deliverable, not a simple generated template.

OUTPUT SPEC:
- Required format: ${input.outputFormat || "Not provided"}
- Size target: ${input.promptFormat || "Match the selected category standard size"}
- Canvas size target: ${input.canvasSize ? `${input.canvasSize.width}x${input.canvasSize.height}` : "Not provided"}

STRUCTURED CONTENT:
${filledFields}

ADDITIONAL INPUT:
- Notes: ${input.notes || "Not provided"}
- Additional text to include on the graphic: ${input.additionalText || "Not provided"}
- Category-specific direction: ${input.promptDirection || "Not provided"}
- Transparent background required: ${input.transparentBackground ? "Yes" : "No"}

DESIGN GOALS:
- Understand the category, field values, uploaded assets, notes, and additional text with high precision before composing anything.
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
- Use ONLY the text supplied in STRUCTURED CONTENT and ADDITIONAL INPUT. Do not invent slogans, taglines, dates, names, contact details, headings, placeholder copy, app names, watermarks, signatures, or filler text.
- If a field, date, contact detail, price, venue, name, or message is missing from the input, leave it missing. Never fabricate placeholder details, lorem ipsum, pseudo-text, fake captions, or decorative text blocks.
- Use ONLY the uploaded logo and uploaded reference images as visual source material. Do not insert unrelated extra images, extra people, fake products, stock-photo elements, stickers, icons, decorative objects, or generated visual fillers that the user did not supply.
- If a business card is requested, create a front-only, ready-to-use professional business card asset with only the provided fields and optional provided logo/images.
- Avoid weak layout, bad text spacing, awkward centering, generic template look, clutter, distorted letters, or low-end styling.
- Avoid basic stock-template aesthetics, random decorations, cheap gradients, bad crops, fake transparent grids, weak type pairing, low contrast text, and amateur alignment.
- Preserve the identity of people, products, and important uploaded objects exactly.
- Do not distort faces or bodies.
- Do not invent unrelated extra subjects.
- Keep text accurate, readable, and well arranged.
- Keep the result natural, premium, brand-ready, and commercially usable.
- For logo requests, keep the mark clean, scalable, centered, and professionally balanced.
- If transparent background is required, return a true transparent alpha background only. Do not add checkerboards, fake transparency grids, paper textures, solid fills, shadows, or placeholder backgrounds.

STRICT SAFETY RULES:
- Do not change a person's face, body, or identity.
- Do not remove important uploaded subject matter.
- Do not corrupt the logo.
- Do not add any text that the user did not provide.
- Do not create messy layouts, overlapping text, weak spacing, or amateur-looking typography.

Return one finished graphic image only.`,
  });

  return generateImageWithRecovery(ai, {
    model,
    parts,
    imageSize: getDefaultImageSize(),
    recoveryText: "Interpret the requested category, all fields, notes, and assets more accurately. Use smarter hierarchy, stronger typography, better spacing, cleaner alignment, better asset placement, and a more premium agency-level finish. Preserve identities and logo integrity exactly, and return one finished professional graphic.",
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
      contents: [
        {
          parts: [
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
          ],
        },
      ],
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
      contents: {
        parts: [
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
        ],
      },
    })
  );

  return extractGeneratedImageBuffer(response);
}

export async function generateVideo(imageUrl: string, prompt: string): Promise<ServerVideoResult> {
  const { base64Data, mimeType } = parseDataUrl(imageUrl);
  const ai = getAI();
  const startedAt = Date.now();
  const videoModels = Array.from(new Set([
    process.env.CHROMANCY_AI_VIDEO_MODEL,
    process.env.GEMINI_VIDEO_MODEL,
    "veo-3.1-fast-generate-preview",
    "veo-3.1-generate-preview",
    "veo-2.0-generate-001",
  ].filter((model): model is string => !!model?.trim())));
  const videoConfig: Record<string, unknown> = {
    numberOfVideos: 1,
    resolution: process.env.CHROMANCY_AI_VIDEO_RESOLUTION || "720p",
  };
  const requestedAspectRatio = process.env.CHROMANCY_AI_VIDEO_ASPECT_RATIO;
  if (requestedAspectRatio) {
    videoConfig.aspectRatio = requestedAspectRatio;
  }

  let operation: Awaited<ReturnType<typeof ai.models.generateVideos>> | null = null;
  let lastVideoError: unknown = null;
  for (const model of videoModels) {
    try {
      operation = await withRetry(() =>
        ai.models.generateVideos({
          model,
          prompt: `Animate this photo with stronger premium-quality motion while staying realistic and identity-safe. First analyze the scene carefully and detect the best natural motion candidates such as blinking, breathing, hair movement, fabric motion, subtle hand motion, environmental movement, gentle parallax, or light movement. Animate only believable localized motions. Improve realism, smoothness, temporal consistency, motion quality, and overall polish significantly compared with a subtle baseline. Keep faces stable, preserve exact identity, preserve body shape, prevent facial morphing, prevent jitter, avoid warped edges, avoid flicker, avoid rubbery motion, and do not animate the whole image equally. Keep the subject recognisable in every frame. Do not introduce captions, overlays, app names, text, watermarks, fake logos, extra people, extra props, replacement backgrounds, scene swaps, or unrelated objects. Make the finished video feel premium, clean, professionally produced, and clearly aligned to the user's request. If the image has limited motion candidates, use restrained premium parallax and natural micro-motion rather than refusing. Only return no video when there is truly no usable subject or scene content. ${prompt}`,
          image: {
            imageBytes: base64Data,
            mimeType,
          },
          config: videoConfig as any,
        })
      );
      break;
    } catch (error) {
      lastVideoError = error;
      console.warn(`Video generation model ${model} failed; trying fallback if available.`, error);
    }
  }

  if (!operation) {
    throw lastVideoError || new Error("Video generation failed.");
  }

  if (operation.error) {
    throw new Error(String(operation.error.message) || "IMAGE_NOT_SUITABLE_FOR_TOOL");
  }

  while (!operation.done) {
    if (Date.now() - startedAt > AI_VIDEO_TIMEOUT_MS) {
      throw new Error("AI_VIDEO_TIMEOUT");
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));

    operation = await withRetry(() =>
      ai.operations.getVideosOperation({ operation })
    );

    if (operation.error) {
      throw new Error(String(operation.error.message) || "IMAGE_NOT_SUITABLE_FOR_TOOL");
    }
  }

  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!downloadLink) {
    throw new Error("IMAGE_NOT_SUITABLE_FOR_TOOL");
  }

  const response = await withRetry(async () => {
    let videoResponse = await fetch(downloadLink, {
      method: "GET",
      headers: {
        "x-goog-api-key": getApiKey(),
      },
    });

    if (!videoResponse.ok && !/[?&]key=/.test(downloadLink)) {
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
      contents: [
        {
          parts: [
            {
              text: "Analyze this marketing visual and predict its likely performance based on design principles, attention flow, and engagement heuristics. Provide a score from 0-100 and a detailed reasoning explaining strengths and weaknesses. Respond in JSON format.",
            },
            {
              inlineData: {
                data: base64Data,
                mimeType,
              },
            },
          ],
        },
      ],
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
