import { auth } from "./firebase";
import type { UnlockCategory } from "./pricing";
import { getDeviceId } from "./device";
import type { UserTier } from "../types";
import { buildApiUrl } from "./api-base";

export type PremiumAccessMode = "free" | "trial" | "wallet" | "pro";

export interface UsageSnapshot {
  tier?: UserTier;
  credits: Record<UnlockCategory, number>;
  wallet?: {
    balanceCents: number;
    balanceZar: number;
    debtCents?: number;
    debtZar?: number;
    proCreditsRemaining: number;
    subscription?: {
      planId: string;
      displayName: string;
      monthlyZar: number;
      monthlyAiCredits: number;
      status?: "inactive" | "active" | "billing_issue" | "cancelled" | "expired";
      isActive?: boolean;
      cycleStartedAt?: string | null;
      cycleEndsAt?: string | null;
      originalTransactionId?: string | null;
      billingIssueDetectedAt?: string | null;
      gracePeriodEndsAt?: string | null;
      hasPriorityProcessing?: boolean;
    } | null;
  };
  transactionHistory?: Array<{
    id: string;
    createdAt: string;
    type: "top-up" | "usage" | "retry" | "refund" | "hold" | "release";
    amountCents: number;
    toolId?: string;
    toolName?: string;
    jobId?: string;
    source?: "free" | "trial" | "pro_credit" | "wallet";
    productId?: string;
    note?: string;
  }>;
  freeTrialRemaining: Record<UnlockCategory, boolean>;
  toolTrialRemaining?: Record<string, boolean>;
  remainingPremiumUses: Record<UnlockCategory, number>;
  pricing: {
    exchangeRate: number;
    premiumMonthlyZar: number;
    subscriptionPlans?: Array<{
      planId: string;
      displayName: string;
      monthlyZar: number;
      monthlyAiCredits: number;
      productId: string;
    }>;
    bundleZar: Record<UnlockCategory, number>;
    aiTiers?: Record<string, { zar: number; retryZar: number }>;
  };
}

interface AccessResponse {
  ok: boolean;
  mode?: PremiumAccessMode;
  reason?: string;
  snapshot?: UsageSnapshot;
}

const FALLBACK_EXCHANGE_RATE = 18.5;

async function getAuthHeaders() {
  const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const token = await auth.currentUser?.getIdToken().catch(() => null);
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function getAuthHeaderOnly() {
  const token = await auth.currentUser?.getIdToken().catch(() => null);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(buildApiUrl(url), {
    method: "POST",
    headers: await getAuthHeaders(),
    cache: "no-store",
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as any)?.error || `Request failed: ${response.status}`);
  }
  return data as T;
}

function getAuthPayload() {
  return {
    uid: auth.currentUser?.uid || null,
    deviceId: getDeviceId(),
  };
}

export async function fetchUsageSnapshot(tier?: UserTier): Promise<UsageSnapshot> {
  return postJson<UsageSnapshot>("/api/usage/snapshot", {
    ...getAuthPayload(),
    tier: tier || "free",
  });
}

export async function requestPremiumToolAccess(category: UnlockCategory, tier: UserTier): Promise<AccessResponse> {
  return postJson<AccessResponse>("/api/usage/consume-access", {
    ...getAuthPayload(),
    category,
    tier,
  });
}

export function getFallbackExchangeRate() {
  return FALLBACK_EXCHANGE_RATE;
}
