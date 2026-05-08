export const AI_PRICE_TIERS = {
  tier1: { zar: 12, retryZar: 6 },
  tier2: { zar: 20, retryZar: 10 },
  tier3: { zar: 39, retryZar: 19.5 },
  tier4: { zar: 45, retryZar: 22.5 },
} as const;

export const WALLET_TOP_UPS = [
  { productId: "chromancy_wallet_50", zar: 50 },
  { productId: "chromancy_wallet_100", zar: 100 },
  { productId: "chromancy_wallet_200", zar: 200 },
  { productId: "chromancy_wallet_500", zar: 500 },
] as const;

export const SUBSCRIPTION_PLANS = [
  {
    planId: "pro",
    displayName: "Pro Monthly",
    productId: "chromancy_pro",
    basePlanId: "monthly",
    revenueCatIdentifier: "chromancy_pro:monthly",
    entitlement: "pro",
    monthlyZar: 179.99,
    monthlyAiCredits: 40,
  },
  {
    planId: "premium",
    displayName: "Premium Monthly",
    productId: "chromancy_premium",
    basePlanId: "monthly",
    revenueCatIdentifier: "chromancy_premium:monthly",
    entitlement: "pro",
    monthlyZar: 249.99,
    monthlyAiCredits: 60,
  },
] as const;

export const PRO_SUBSCRIPTION = SUBSCRIPTION_PLANS[0];
export const PREMIUM_SUBSCRIPTION = SUBSCRIPTION_PLANS[1];

export const SUPPORTED_WALLET_COUNTRIES = {
  ZA: { label: "South Africa", currency: "ZAR", symbol: "R", rateFromZar: 1 },
  US: { label: "United States", currency: "USD", symbol: "$", rateFromZar: 0.054 },
  GB: { label: "United Kingdom", currency: "GBP", symbol: "GBP", rateFromZar: 0.043 },
  AE: { label: "UAE", currency: "AED", symbol: "AED", rateFromZar: 0.2 },
  AU: { label: "Australia", currency: "AUD", symbol: "$", rateFromZar: 0.083 },
} as const;

export type ToolCategory = "photo" | "video" | "design" | "business";
export type ToolPricingTier = "free" | keyof typeof AI_PRICE_TIERS;

export interface ToolConfig {
  internalId: string;
  displayName: string;
  category: ToolCategory;
  pricingTier: ToolPricingTier;
  isAi: boolean;
  trialEligible: boolean;
  proCreditCost?: number;
}

export const TOOL_CONFIGS = [
  { internalId: "manual_edit", displayName: "MANUAL EDIT", category: "photo", pricingTier: "free", isAi: false, trialEligible: false },
  { internalId: "one_tap_fix", displayName: "1-TAP FIX", category: "photo", pricingTier: "free", isAi: false, trialEligible: false },
  { internalId: "fix_lighting", displayName: "FIX LIGHTING", category: "photo", pricingTier: "free", isAi: false, trialEligible: false },
  { internalId: "sharpen", displayName: "SHARPEN", category: "photo", pricingTier: "free", isAi: false, trialEligible: false },
  { internalId: "hd_upgrade", displayName: "HD UPGRADE", category: "photo", pricingTier: "tier2", isAi: true, trialEligible: false },
  { internalId: "extend_photo", displayName: "EXTEND PHOTO", category: "photo", pricingTier: "tier3", isAi: true, trialEligible: true },
  { internalId: "change_background", displayName: "CHANGE BACKGROUND", category: "photo", pricingTier: "tier2", isAi: true, trialEligible: true },
  { internalId: "change_vibe", displayName: "CHANGE VIBE", category: "photo", pricingTier: "tier3", isAi: true, trialEligible: false },
  { internalId: "pose_perfect", displayName: "POSE PERFECT", category: "photo", pricingTier: "tier3", isAi: true, trialEligible: true },
  { internalId: "smooth_skin", displayName: "SMOOTH SKIN", category: "photo", pricingTier: "tier1", isAi: true, trialEligible: false },
  { internalId: "remove_clutter_photo", displayName: "REMOVE CLUTTER", category: "photo", pricingTier: "tier2", isAi: true, trialEligible: false },
  { internalId: "blur_background", displayName: "BLUR BACKGROUND", category: "photo", pricingTier: "tier1", isAi: true, trialEligible: false },
  { internalId: "pro_headshot", displayName: "PRO HEADSHOT", category: "photo", pricingTier: "tier3", isAi: true, trialEligible: false },
  { internalId: "face_focus_enhancer", displayName: "FACE FOCUS ENHANCER", category: "photo", pricingTier: "tier1", isAi: true, trialEligible: false },
  { internalId: "animate", displayName: "ANIMATE", category: "photo", pricingTier: "tier3", isAi: true, trialEligible: false, proCreditCost: 5 },
  { internalId: "video_manual_edit", displayName: "MANUAL EDIT", category: "video", pricingTier: "free", isAi: false, trialEligible: false },
  { internalId: "video_fix_lighting", displayName: "FIX LIGHTING", category: "video", pricingTier: "free", isAi: false, trialEligible: false },
  { internalId: "one_tap_video_fix", displayName: "1-TAP VIDEO FIX", category: "video", pricingTier: "free", isAi: false, trialEligible: false },
  { internalId: "beam_mode", displayName: "BEAM MODE", category: "video", pricingTier: "free", isAi: false, trialEligible: false },
  { internalId: "pro_look", displayName: "PRO LOOK", category: "video", pricingTier: "free", isAi: false, trialEligible: false },
  { internalId: "design_critic", displayName: "DESIGN CRITIC", category: "design", pricingTier: "tier2", isAi: true, trialEligible: true },
  { internalId: "one_tap_design_fix", displayName: "1-TAP DESIGN FIX", category: "design", pricingTier: "tier2", isAi: true, trialEligible: false },
  { internalId: "design_brand_image", displayName: "MAKE PRO", category: "design", pricingTier: "tier2", isAi: true, trialEligible: true },
  { internalId: "make_it_pop", displayName: "MAKE IT POP", category: "design", pricingTier: "tier1", isAi: true, trialEligible: false },
  { internalId: "clean_up", displayName: "CLEAN UP", category: "design", pricingTier: "tier1", isAi: true, trialEligible: false },
  { internalId: "fix_type", displayName: "FIX TYPE", category: "design", pricingTier: "tier2", isAi: true, trialEligible: true },
  { internalId: "mockup_generator", displayName: "MOCKUP GENERATOR", category: "business", pricingTier: "tier2", isAi: true, trialEligible: true },
  { internalId: "food_enhancer", displayName: "FOOD ENHANCER", category: "business", pricingTier: "tier2", isAi: true, trialEligible: false },
  { internalId: "studio_shot", displayName: "STUDIO SHOT", category: "business", pricingTier: "tier2", isAi: true, trialEligible: false },
  { internalId: "business_brand_image", displayName: "BRAND PHOTO", category: "business", pricingTier: "tier2", isAi: true, trialEligible: true },
  { internalId: "create", displayName: "CREATE", category: "business", pricingTier: "tier3", isAi: true, trialEligible: false, proCreditCost: 3 },
  { internalId: "smart_performance_predictor", displayName: "SMART PERFORMANCE PREDICTOR", category: "business", pricingTier: "tier3", isAi: true, trialEligible: false },
] as const satisfies readonly ToolConfig[];

export type ToolInternalId = typeof TOOL_CONFIGS[number]["internalId"];

export const TOOL_CONFIG_BY_ID = Object.fromEntries(
  TOOL_CONFIGS.map((tool) => [tool.internalId, tool]),
) as Record<ToolInternalId, ToolConfig>;

export const UI_TOOL_TO_INTERNAL_ID: Record<string, ToolInternalId> = {
  manual: "manual_edit",
  "1tap": "one_tap_fix",
  light: "fix_lighting",
  sharp: "sharpen",
  hd: "hd_upgrade",
  outpaint: "extend_photo",
  change_bg: "change_background",
  vibe: "change_vibe",
  pose: "pose_perfect",
  skin: "smooth_skin",
  remove: "remove_clutter_photo",
  blur: "blur_background",
  headshot: "pro_headshot",
  face: "face_focus_enhancer",
  animate: "animate",
  critic: "design_critic",
  scorer: "design_critic",
  fix: "one_tap_design_fix",
  fixer: "one_tap_design_fix",
  pro: "business_brand_image",
  pop: "make_it_pop",
  standout: "make_it_pop",
  cleanup: "clean_up",
  clean: "clean_up",
  type: "fix_type",
  mockup: "mockup_generator",
  food: "food_enhancer",
  studio: "studio_shot",
  create: "create",
  predict: "smart_performance_predictor",
};

export function getToolConfig(internalId?: string | null) {
  if (!internalId) return null;
  return TOOL_CONFIG_BY_ID[internalId as ToolInternalId] || null;
}

export function getToolPriceZar(internalId?: string | null, retry = false) {
  const tool = getToolConfig(internalId);
  if (!tool || tool.pricingTier === "free") return 0;
  const price = AI_PRICE_TIERS[tool.pricingTier];
  return retry ? price.retryZar : price.zar;
}

export function getToolPriceCents(internalId?: string | null, retry = false) {
  return Math.round(getToolPriceZar(internalId, retry) * 100);
}

export function getToolProCreditCost(internalId?: string | null, retry = false) {
  const tool = getToolConfig(internalId);
  if (!tool || !tool.isAi || tool.pricingTier === "free") return 0;
  const baseCredits = Math.max(1, Math.round(tool.proCreditCost || 1));
  return retry ? Math.max(1, Math.ceil(baseCredits / 2)) : baseCredits;
}

export function getSubscriptionPlan(productId?: string | null) {
  if (!productId) return null;
  const normalizedProductId = productId.toLowerCase();
  return SUBSCRIPTION_PLANS.find((plan) =>
    plan.productId === productId ||
    plan.revenueCatIdentifier === productId ||
    `${plan.productId}:${plan.basePlanId}` === productId ||
    plan.planId === productId ||
    normalizedProductId.includes(plan.productId.toLowerCase()) ||
    normalizedProductId.includes(plan.revenueCatIdentifier.toLowerCase())
  ) || null;
}

export function isAiTool(internalId?: string | null) {
  return !!getToolConfig(internalId)?.isAi;
}
