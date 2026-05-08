import { UserTier } from "../types";
import { fetchUsageSnapshot, getFallbackExchangeRate, requestPremiumToolAccess, type PremiumAccessMode as ServerPremiumAccessMode, type UsageSnapshot } from "./serverUsage";
import { PRO_SUBSCRIPTION, SUBSCRIPTION_PLANS, WALLET_TOP_UPS } from "./toolConfig";
import { isSubscriberTier } from "./tier";

export type UnlockCategory = "photo" | "video" | "design" | "business";
export type PremiumAccessMode = ServerPremiumAccessMode;

const SUBSCRIBE_VIEW_KEY = "chromancy_subscribe_view";
const ACK_KEY = "chromancy_bundle_ack";
const FREE_TEST_MODE = import.meta.env.VITE_CHROMANCY_FREE_TEST_MODE === "true";

export const aiTierPricing = {
  tier1: 12,
  tier2: 20,
  tier3: 39,
  tier4: 45,
} as const;

export const walletTopUpPricing = WALLET_TOP_UPS.map((topUp) => topUp.zar);
export const subscriptionPlanPricing = SUBSCRIPTION_PLANS.map((plan) => ({
  ...plan,
  vatIncluded: true,
}));

type BundlePricingPreview = {
  zar: number;
  uses: number;
  label: string;
  displayPrice: string;
  summary: string;
  note: string;
};

const bundlePricing: Record<UnlockCategory, BundlePricingPreview> = {
  photo: {
    zar: aiTierPricing.tier3,
    uses: 1,
    label: "AI Photo Enhancement tools",
    displayPrice: "R12 / R20 / R39",
    summary: "Photo AI pricing varies by tool and follows the final wallet tiers.",
    note: "Wallet top-ups: R50 / R100 / R200 / R500.",
  },
  video: {
    zar: 0,
    uses: 0,
    label: "Video Enhancement tools",
    displayPrice: "Free",
    summary: "Current video tools are planned to stay free in the pricing model.",
    note: "No AI wallet charge applies to the current video tools.",
  },
  design: {
    zar: aiTierPricing.tier2,
    uses: 1,
    label: "AI Design tools",
    displayPrice: "R12 / R20 / R39",
    summary: "Polish tools use the final AI wallet tiers depending on the tool.",
    note: "Wallet top-ups: R50 / R100 / R200 / R500.",
  },
  business: {
    zar: aiTierPricing.tier3,
    uses: 1,
    label: "AI Business tools",
    displayPrice: "R20 / R39",
    summary: "Level Up tools use the final AI wallet tiers depending on the tool. CREATE currently costs R39 or 3 AI Credits.",
    note: "Wallet top-ups: R50 / R100 / R200 / R500.",
  },
};

export const premiumMonthlyPricing = {
  zar: PRO_SUBSCRIPTION.monthlyZar,
  credits: PRO_SUBSCRIPTION.monthlyAiCredits,
  designUses: 18,
  photoUses: 18,
  businessUses: 18,
  videoUses: 7,
};

const DEFAULT_USAGE_SNAPSHOT: UsageSnapshot = {
  tier: "free",
  credits: { photo: 0, video: 0, design: 0, business: 0 },
  freeTrialRemaining: { photo: true, video: true, design: true, business: true },
  remainingPremiumUses: {
    photo: premiumMonthlyPricing.photoUses,
    video: premiumMonthlyPricing.videoUses,
    design: premiumMonthlyPricing.designUses,
    business: premiumMonthlyPricing.businessUses,
  },
    pricing: {
    exchangeRate: getFallbackExchangeRate(),
    premiumMonthlyZar: premiumMonthlyPricing.zar,
    subscriptionPlans: subscriptionPlanPricing.map((plan) => ({
      planId: plan.planId,
      displayName: plan.displayName,
      monthlyZar: plan.monthlyZar,
      monthlyAiCredits: plan.monthlyAiCredits,
      productId: plan.productId,
    })),
    bundleZar: {
      photo: bundlePricing.photo.zar,
      video: bundlePricing.video.zar,
      design: bundlePricing.design.zar,
      business: bundlePricing.business.zar,
    },
  },
};

let usageSnapshotCache: UsageSnapshot = { ...DEFAULT_USAGE_SNAPSHOT };

function normalizeUsageSnapshot(snapshot?: Partial<UsageSnapshot> | null): UsageSnapshot {
  const safePricing = snapshot?.pricing || {} as UsageSnapshot["pricing"];
  const safeWallet = snapshot?.wallet;
  return {
    tier: snapshot?.tier || DEFAULT_USAGE_SNAPSHOT.tier,
    credits: {
      ...DEFAULT_USAGE_SNAPSHOT.credits,
      ...(snapshot?.credits || {}),
    },
    wallet: safeWallet ? {
      balanceCents: Math.max(0, Number(safeWallet.balanceCents) || 0),
      balanceZar: typeof safeWallet.balanceZar === "number" ? safeWallet.balanceZar : Math.max(0, Number(safeWallet.balanceCents) || 0) / 100,
      debtCents: Math.max(0, Number(safeWallet.debtCents) || 0),
      debtZar: typeof safeWallet.debtZar === "number" ? safeWallet.debtZar : Math.max(0, Number(safeWallet.debtCents) || 0) / 100,
      proCreditsRemaining: Math.max(0, Number(safeWallet.proCreditsRemaining) || 0),
      subscription: safeWallet.subscription ? {
        ...safeWallet.subscription,
      } : null,
    } : undefined,
    transactionHistory: Array.isArray(snapshot?.transactionHistory) ? snapshot.transactionHistory : [],
    freeTrialRemaining: {
      ...DEFAULT_USAGE_SNAPSHOT.freeTrialRemaining,
      ...(snapshot?.freeTrialRemaining || {}),
    },
    toolTrialRemaining: snapshot?.toolTrialRemaining || {},
    remainingPremiumUses: {
      ...DEFAULT_USAGE_SNAPSHOT.remainingPremiumUses,
      ...(snapshot?.remainingPremiumUses || {}),
    },
    pricing: {
      exchangeRate: typeof safePricing.exchangeRate === "number" && Number.isFinite(safePricing.exchangeRate) && safePricing.exchangeRate > 0
        ? safePricing.exchangeRate
        : DEFAULT_USAGE_SNAPSHOT.pricing.exchangeRate,
      premiumMonthlyZar: typeof safePricing.premiumMonthlyZar === "number" && Number.isFinite(safePricing.premiumMonthlyZar) && safePricing.premiumMonthlyZar > 0
        ? safePricing.premiumMonthlyZar
        : DEFAULT_USAGE_SNAPSHOT.pricing.premiumMonthlyZar,
      subscriptionPlans: Array.isArray(safePricing.subscriptionPlans) && safePricing.subscriptionPlans.length
        ? safePricing.subscriptionPlans
        : DEFAULT_USAGE_SNAPSHOT.pricing.subscriptionPlans,
      bundleZar: {
        ...DEFAULT_USAGE_SNAPSHOT.pricing.bundleZar,
        ...(safePricing.bundleZar || {}),
      },
    },
  };
}

export function getBundlePricing(category: UnlockCategory) {
  return bundlePricing[category];
}

export function getWalletTopUpLabel() {
  return walletTopUpPricing.map((amount) => `R${amount} + VAT`).join(" / ");
}

export function formatZarAmount(zar: number) {
  return Number.isInteger(zar) ? `${zar}` : zar.toFixed(2);
}

export function formatZarUsd(zar: number, exchangeRate?: number) {
  const safeExchangeRate = typeof exchangeRate === "number" && Number.isFinite(exchangeRate) && exchangeRate > 0
    ? exchangeRate
    : usageSnapshotCache?.pricing?.exchangeRate || DEFAULT_USAGE_SNAPSHOT.pricing.exchangeRate || getFallbackExchangeRate();
  const usd = zar / safeExchangeRate;
  return `ZAR R${formatZarAmount(zar)} / USD $${usd.toFixed(2)}`;
}

export function getUsageSnapshotCache() {
  return usageSnapshotCache;
}

export async function refreshUsageSnapshot(tier?: UserTier) {
  try {
    usageSnapshotCache = normalizeUsageSnapshot(await fetchUsageSnapshot(tier));
  } catch {
    usageSnapshotCache = normalizeUsageSnapshot(usageSnapshotCache);
  }
  return usageSnapshotCache;
}

export function applyUsageSnapshot(snapshot: UsageSnapshot) {
  usageSnapshotCache = normalizeUsageSnapshot(snapshot);
  return usageSnapshotCache;
}

export function getCredits() {
  return usageSnapshotCache.credits;
}

export function getCategoryCredits(category: UnlockCategory) {
  return usageSnapshotCache.credits[category] || 0;
}

export function hasPremiumExportAccess(category: UnlockCategory, tier: UserTier, accessMode?: PremiumAccessMode) {
  if (FREE_TEST_MODE) return true;
  if (isSubscriberTier(tier)) return true;
  if (accessMode === "wallet") return true;
  return false;
}

export async function preparePremiumToolAccess(category: UnlockCategory, tier: UserTier): Promise<{ ok: boolean; mode?: PremiumAccessMode; reason?: string }> {
  if (FREE_TEST_MODE) {
    return { ok: true, mode: "free" };
  }

  try {
    const result = await requestPremiumToolAccess(category, tier);
    if (result.snapshot) applyUsageSnapshot(result.snapshot);
    return { ok: result.ok, mode: result.mode, reason: result.reason };
  } catch {
    return {
      ok: false,
      reason: `We could not verify ${bundlePricing[category].label} access with the server. Please try again.`,
    };
  }
}

export async function waitForUsageSnapshot(
  predicate: (snapshot: UsageSnapshot) => boolean,
  options?: { tier?: UserTier; timeoutMs?: number; intervalMs?: number },
) {
  const timeoutMs = Math.max(2000, options?.timeoutMs || 20000);
  const intervalMs = Math.max(250, options?.intervalMs || 1500);
  const startedAt = Date.now();
  let latest = usageSnapshotCache;

  while (Date.now() - startedAt <= timeoutMs) {
    latest = await refreshUsageSnapshot(options?.tier);
    if (predicate(latest)) {
      return latest;
    }
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
  }

  return latest;
}

export type SubscriptionView = "premium" | "unlock";

export function setSubscriptionView(view: SubscriptionView | UnlockCategory) {
  const normalized = view === "premium" ? "premium" : "unlock";
  localStorage.setItem(SUBSCRIBE_VIEW_KEY, normalized);
}

export function getSubscriptionView(): SubscriptionView {
  const value = localStorage.getItem(SUBSCRIBE_VIEW_KEY);
  return value === "unlock" ? "unlock" : "premium";
}

export function setBundleAgreementAccepted(category: UnlockCategory) {
  localStorage.setItem(`${ACK_KEY}_${category}`, "1");
}

export function hasBundleAgreementAccepted(category: UnlockCategory) {
  return localStorage.getItem(`${ACK_KEY}_${category}`) === "1";
}
