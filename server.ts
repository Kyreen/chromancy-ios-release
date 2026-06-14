import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  analyzeDesign as analyzeDesignWithGemini,
  createBusinessGraphic as createBusinessGraphicWithGemini,
  enhancePhoto as enhancePhotoWithGemini,
  generateVideo as generateVideoWithGemini,
  isAiConfigured,
  isUnsuitableInputError as isUnsuitableAiInput,
  planBusinessGraphicDesign as planBusinessGraphicDesignWithGemini,
  renderBusinessGraphicDesignPlan as renderBusinessGraphicDesignPlanWithGemini,
  posePerfect as posePerfectWithGemini,
  predictPerformance as predictPerformanceWithGemini,
  removeObject as removeObjectWithGemini,
} from "./server-ai";
import {
  AI_PRICE_TIERS,
  PRO_SUBSCRIPTION,
  SUBSCRIPTION_PLANS,
  TOOL_CONFIGS,
  WALLET_TOP_UPS,
  getToolConfig,
  getToolPriceCents,
  getToolProCreditCost,
  getSubscriptionPlan,
  type ToolInternalId,
} from "./src/lib/toolConfig";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "data");
const STORE_PATH = path.join(DATA_DIR, "usage-store.json");
const PORT = Number(process.env.PORT || 3000);
const HASH_SALT = process.env.CHROMANCY_USAGE_SALT || "chromancy-local-salt-change-me";
const EXCHANGE_RATE = Number(process.env.CHROMANCY_ZAR_USD_RATE || 18.5);
const SUPPORT_INBOX = "info@chromancy.online";
const IS_PRODUCTION = ["production", "prod"].includes(String(process.env.NODE_ENV || process.env.CHROMANCY_ENV || "").toLowerCase());
const SMTP_HOST = process.env.CHROMANCY_SUPPORT_SMTP_HOST || "";
const SMTP_PORT = Number(process.env.CHROMANCY_SUPPORT_SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.CHROMANCY_SUPPORT_SMTP_SECURE || "false") === "true";
const SMTP_USER = process.env.CHROMANCY_SUPPORT_SMTP_USER || "";
const SMTP_PASS = process.env.CHROMANCY_SUPPORT_SMTP_PASS || "";
const SMTP_FROM = process.env.CHROMANCY_SUPPORT_FROM || SUPPORT_INBOX;
const REVENUECAT_WEBHOOK_SECRET = process.env.REVENUECAT_WEBHOOK_SECRET || "";
const REQUIRE_REVENUECAT_WEBHOOK_SECRET = String(process.env.REVENUECAT_REQUIRE_WEBHOOK_SECRET || (IS_PRODUCTION ? "true" : "false")) === "true";


const AI_PROVIDER_CONFIGURED = isAiConfigured();
const AI_PROVIDER_NAME = String(process.env.CHROMANCY_AI_PROVIDER || process.env.GOOGLE_GENAI_USE_VERTEXAI || "vertex").toLowerCase();
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
const USAGE_STORE_COLLECTION = process.env.CHROMANCY_USAGE_STORE_COLLECTION || "server_private";
const USAGE_STORE_DOC_ID = process.env.CHROMANCY_USAGE_STORE_DOC_ID || "billing_usage_store";
const FORCE_LOCAL_USAGE_STORE = String(process.env.CHROMANCY_USE_LOCAL_USAGE_STORE || "false") === "true";
const FREE_TEST_MODE = String(process.env.CHROMANCY_FREE_TEST_MODE || "false") === "true";
const FREE_TEST_ALLOWED_UIDS = new Set(
  (process.env.CHROMANCY_FREE_TEST_UIDS || "")
    .split(",")
    .map((uid) => uid.trim())
    .filter(Boolean),
);
const FREE_TEST_ALLOWED_EMAILS = new Set(
  (process.env.CHROMANCY_FREE_TEST_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);
const FREE_TEST_ALLOWLIST_CONFIGURED = FREE_TEST_ALLOWED_UIDS.size > 0 || FREE_TEST_ALLOWED_EMAILS.size > 0;
const ALLOW_INSECURE_UID_FALLBACK = String(process.env.CHROMANCY_ALLOW_INSECURE_UID_FALLBACK || "false") === "true";
const CLIENT_CRASH_LOGS_ENABLED = String(process.env.CHROMANCY_CRASH_LOGS_ENABLED || "false") === "true";
const CLIENT_CRASH_RATE_LIMIT_MAX = Math.max(3, Number(process.env.CHROMANCY_CLIENT_CRASH_RATE_LIMIT || 12));

function initFirebaseAdmin() {
  if (getApps().length) return true;

  try {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "";
    if (rawServiceAccount.trim()) {
      initializeApp({
        credential: cert(JSON.parse(rawServiceAccount)),
        projectId: FIREBASE_PROJECT_ID || undefined,
      });
      return true;
    }

    initializeApp({
      credential: applicationDefault(),
      projectId: FIREBASE_PROJECT_ID || undefined,
    });
    return true;
  } catch (error) {
    console.warn("Firebase Admin was not initialized; authenticated backend mutations will be limited until backend credentials are configured.");
    return false;
  }
}

const FIREBASE_ADMIN_READY = initFirebaseAdmin();


function isAiBusyMessage(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("resource_exhausted")
    || normalized.includes("rate limit")
    || normalized.includes("too many requests")
    || normalized.includes("unavailable")
    || normalized.includes("temporar")
    || normalized.includes("internal")
    || normalized.includes("overloaded")
    || normalized.includes("busy");
}

function buildAiErrorResponse(error: any, fallback: string) {
  const rawMessage = String(error?.message || fallback);
  let message = rawMessage;
  try {
    const parsed = JSON.parse(rawMessage);
    message = String(parsed?.error?.message || parsed?.message || rawMessage);
  } catch {
    message = rawMessage;
  }
  let serialized = "";
  try {
    serialized = JSON.stringify(error || {});
  } catch {
    serialized = "";
  }
  const combinedMessage = `${rawMessage} ${message} ${serialized}`.toLowerCase();
  if (message === "VERTEX_AI_REQUEST_ROLE_INVALID" || (combinedMessage.includes("invalid_argument") && combinedMessage.includes("valid role"))) {
    return { status: 503, error: "AI service is refreshing its Vertex connection. Please try again in a moment." };
  }
  if (message === "API_KEY_REQUIRED" || message === "VERTEX_AI_CONFIG_REQUIRED" || message === "VERTEX_AI_AUTH_REQUIRED") {
    return { status: 503, error: "AI service is not ready right now. Please try again in a moment." };
  }
  if (message === "AI_REQUEST_TIMEOUT" || message === "AI_VIDEO_TIMEOUT") {
    return { status: 504, error: "AI took too long to finish this request. Please try again." };
  }
  if (message === "IMAGE_GENERATION_EMPTY") {
    return { status: 502, error: "AI did not return a usable result. Please try again with the same image or a clearer request." };
  }
  if (message === "AI_VIDEO_SAFETY_BLOCKED") {
    return { status: 422, error: "Animate was blocked by the AI provider's content-safety policy for this photo. This commonly affects photos of real, identifiable people. Please try a different subject (such as a product, pet, or scene)." };
  }
  if (message === "AI_VIDEO_GENERATION_FAILED") {
    return { status: 502, error: "AI could not animate this photo cleanly just yet. Please try again with the same photo." };
  }
  if (isUnsuitableAiInput(error)) {
    return { status: 422, error: "This image is not suited for this tool. Please upload a different one and try again." };
  }
  if (isAiBusyMessage(message)) {
    return { status: 503, error: "AI is busy right now. Please wait a moment and try again." };
  }
  return { status: 500, error: message };
}

const PREMIUM_LIMITS = {
  photo: 18,
  design: 18,
  business: 18,
  video: 7,
} as const;

const PREMIUM_MONTHLY_ZAR = PRO_SUBSCRIPTION.monthlyZar;
const PRO_MONTHLY_AI_CREDITS = PRO_SUBSCRIPTION.monthlyAiCredits;
const CATEGORIES = ["photo", "video", "design", "business"] as const;
type UnlockCategory = typeof CATEGORIES[number];
type UserTier = "free" | "pay-as-you-use" | "pro" | "premium";
type FundingSource = "free" | "trial" | "pro_credit" | "wallet";
type TransactionType = "top-up" | "usage" | "retry" | "refund" | "hold" | "release";
type JobStatus = "queued" | "processing" | "success" | "failed";
type SubscriptionStatus = "inactive" | "active" | "billing_issue" | "cancelled" | "expired";

interface UsageStore {
  accounts: Record<string, AccountRecord>;
  devices: Record<string, DeviceRecord>;
  ipTrials: Record<string, Record<UnlockCategory, number>>;
  ipToolTrials?: Record<string, Record<string, number>>;
}

interface AccountRecord {
  credits: Record<UnlockCategory, number>;
  premiumUsage: Record<UnlockCategory, number>;
  premiumUsageMonth: string;
  freeTrials: Record<UnlockCategory, number>;
  walletCents?: number;
  proCredits?: number;
  proCreditsMonth?: string;
  proEntitlementActive?: boolean;
  proMonthlyCreditAllowance?: number;
  activeSubscriptionPlanId?: string;
  activeSubscriptionProductId?: string;
  subscriptionStatus?: SubscriptionStatus;
  subscriptionCycleId?: string;
  subscriptionCycleStartedAt?: string;
  subscriptionCycleEndsAt?: string;
  subscriptionOriginalTransactionId?: string;
  lastSubscriptionPurchaseAt?: string;
  billingIssueDetectedAt?: string;
  gracePeriodEndsAt?: string;
  toolFreeTrials?: Record<string, number>;
  transactions?: LedgerTransaction[];
  holds?: Record<string, JobHold>;
  jobs?: Record<string, AiJobRecord>;
  processedPurchases?: Record<string, string>;
  processedPurchaseFingerprints?: Record<string, string>;
  processedWebhookEvents?: Record<string, string>;
  reversedPurchases?: Record<string, string>;
}

interface DeviceRecord {
  freeTrials: Record<UnlockCategory, number>;
  toolFreeTrials?: Record<string, number>;
}

interface LedgerTransaction {
  id: string;
  createdAt: string;
  type: TransactionType;
  amountCents: number;
  toolId?: string;
  toolName?: string;
  jobId?: string;
  source?: FundingSource;
  productId?: string;
  note?: string;
}

interface JobHold {
  id: string;
  createdAt: string;
  finalizedAt?: string;
  releasedAt?: string;
  status: "held" | "finalized" | "released";
  toolId: string;
  toolName: string;
  amountCents: number;
  proCreditCost?: number;
  source: FundingSource;
  isRetry: boolean;
  originalJobId?: string;
  idempotencyKey?: string;
}

interface AiJobRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  toolId: string;
  toolName: string;
  amountCents: number;
  source: FundingSource;
  holdId: string;
  error?: string;
  resultAvailable?: boolean;
}

const FREE_TRIAL_LIMIT = 1;
const LEDGER_LIMIT = 250;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_AI_JOBS = 12;
const MAX_CONCURRENT_JOBS = 2;
const AI_JOB_STALE_MS = Math.max(60_000, Number(process.env.CHROMANCY_AI_JOB_STALE_MS || 15 * 60_000));

const emptyCredits = (): Record<UnlockCategory, number> => ({ photo: 0, video: 0, design: 0, business: 0 });
const emptyTrialCounts = (): Record<UnlockCategory, number> => ({ photo: 0, video: 0, design: 0, business: 0 });
const emptyPremiumUsage = (): Record<UnlockCategory, number> => ({ photo: 0, video: 0, design: 0, business: 0 });
const currentMonthKey = () => new Date().toISOString().slice(0, 7);
const zarToCents = (zar: number) => Math.round(zar * 100);
const centsToZar = (cents: number) => Number((cents / 100).toFixed(2));
const nowIso = () => new Date().toISOString();

function makeId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

function normalizeSubscriptionStatus(value: unknown, fallback: SubscriptionStatus = "inactive"): SubscriptionStatus {
  return value === "active" || value === "billing_issue" || value === "cancelled" || value === "expired" || value === "inactive"
    ? value
    : fallback;
}

function toIsoOrUndefined(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString();
  }
  return undefined;
}

function toMillis(value?: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isAnonymousRevenueCatId(value?: string | null) {
  return typeof value === "string" && value.startsWith("$RCAnonymousID:");
}

function getSubscriptionPlanForAccount(account?: AccountRecord | null) {
  return getSubscriptionPlan(account?.activeSubscriptionProductId) ||
    SUBSCRIPTION_PLANS.find((plan) => plan.planId === account?.activeSubscriptionPlanId) ||
    null;
}

function getEffectiveSubscriptionEndAt(account?: AccountRecord | null) {
  return account?.gracePeriodEndsAt || account?.subscriptionCycleEndsAt || null;
}

function buildSubscriptionCycleId(planProductId: string, cycleStartedAt?: string, cycleEndsAt?: string, originalTransactionId?: string) {
  return [planProductId, cycleStartedAt || "", cycleEndsAt || "", originalTransactionId || ""].join("|");
}

function buildWalletPurchaseFingerprint(productId: string, purchasedAt?: string | null) {
  const purchaseMs = toMillis(purchasedAt || null);
  return purchaseMs ? `${productId}:${purchaseMs}` : null;
}

function subscriptionStatusAllowsAccess(status: SubscriptionStatus) {
  return status === "active" || status === "billing_issue" || status === "cancelled";
}

function ensureSubscriptionStateFresh(account: AccountRecord) {
  const plan = getSubscriptionPlanForAccount(account);
  if (!plan || !account.proEntitlementActive) {
    account.subscriptionStatus = normalizeSubscriptionStatus(account.subscriptionStatus, "inactive");
    if (!subscriptionStatusAllowsAccess(account.subscriptionStatus)) {
      account.proCredits = 0;
    }
    return;
  }

  const effectiveEndsAtMs = toMillis(getEffectiveSubscriptionEndAt(account));
  if (effectiveEndsAtMs && effectiveEndsAtMs <= Date.now()) {
    account.proEntitlementActive = false;
    account.proCredits = 0;
    account.subscriptionStatus = "expired";
  } else {
    account.subscriptionStatus = normalizeSubscriptionStatus(account.subscriptionStatus, "active");
  }
}

function resolveUserTier(account?: AccountRecord | null): UserTier {
  const plan = getSubscriptionPlanForAccount(account);
  const status = normalizeSubscriptionStatus(account?.subscriptionStatus, account?.proEntitlementActive ? "active" : "inactive");
  if (plan && account?.proEntitlementActive && subscriptionStatusAllowsAccess(status)) {
    return plan.planId === "premium" ? "premium" : "pro";
  }

  return Math.max(0, Number(account?.walletCents) || 0) > 0 ? "pay-as-you-use" : "free";
}

function hasPriorityProcessing(account?: AccountRecord | null) {
  return resolveUserTier(account) === "premium";
}

function emptyToolTrials(): Record<string, number> {
  return Object.fromEntries(TOOL_CONFIGS.map((tool) => [tool.internalId, 0]));
}

function normalizeToolTrials(value: unknown): Record<string, number> {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return Object.fromEntries(TOOL_CONFIGS.map((tool) => {
    const count = source[tool.internalId];
    return [tool.internalId, typeof count === "number" ? Math.max(0, count) : count ? 1 : 0];
  }));
}

function normalizeTransactions(value: unknown): LedgerTransaction[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item: any) => ({
      id: String(item.id || makeId("tx")),
      createdAt: String(item.createdAt || nowIso()),
      type: item.type || "usage",
      amountCents: Number.isFinite(Number(item.amountCents)) ? Number(item.amountCents) : 0,
      toolId: item.toolId ? String(item.toolId) : undefined,
      toolName: item.toolName ? String(item.toolName) : undefined,
      jobId: item.jobId ? String(item.jobId) : undefined,
      source: item.source,
      productId: item.productId ? String(item.productId) : undefined,
      note: item.note ? String(item.note).slice(0, 300) : undefined,
    }))
    .slice(-LEDGER_LIMIT);
}

function normalizeRecordMap<T>(value: unknown): Record<string, T> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, T> : {};
}
const normalizeTrialCounts = (value: unknown): Record<UnlockCategory, number> => {
  const source = (value && typeof value === "object" ? value : {}) as Partial<Record<UnlockCategory, unknown>>;
  return {
    photo: typeof source.photo === "number" ? Math.max(0, source.photo) : source.photo ? 1 : 0,
    video: typeof source.video === "number" ? Math.max(0, source.video) : source.video ? 1 : 0,
    design: typeof source.design === "number" ? Math.max(0, source.design) : source.design ? 1 : 0,
    business: typeof source.business === "number" ? Math.max(0, source.business) : source.business ? 1 : 0,
  };
};

function createEmptyStore(): UsageStore {
  return { accounts: {}, devices: {}, ipTrials: {}, ipToolTrials: {} };
}

function normalizeUsageStore(parsed?: Partial<UsageStore> | null): UsageStore {
  const accounts = Object.fromEntries(Object.entries(parsed?.accounts || {}).map(([key, value]) => [key, {
    credits: { ...emptyCredits(), ...((value as any)?.credits || {}) },
    premiumUsage: { ...emptyPremiumUsage(), ...((value as any)?.premiumUsage || {}) },
    premiumUsageMonth: (value as any)?.premiumUsageMonth || currentMonthKey(),
    freeTrials: normalizeTrialCounts((value as any)?.freeTrials),
    walletCents: Math.round(Number((value as any)?.walletCents) || 0),
    proCredits: Math.max(0, Number((value as any)?.proCredits) || 0),
    proCreditsMonth: (value as any)?.proCreditsMonth || currentMonthKey(),
    proEntitlementActive: Boolean((value as any)?.proEntitlementActive),
    proMonthlyCreditAllowance: Math.max(0, Number((value as any)?.proMonthlyCreditAllowance) || PRO_MONTHLY_AI_CREDITS),
    activeSubscriptionPlanId: (value as any)?.activeSubscriptionPlanId ? String((value as any).activeSubscriptionPlanId) : undefined,
    activeSubscriptionProductId: (value as any)?.activeSubscriptionProductId ? String((value as any).activeSubscriptionProductId) : undefined,
    subscriptionStatus: normalizeSubscriptionStatus((value as any)?.subscriptionStatus, (value as any)?.proEntitlementActive ? "active" : "inactive"),
    subscriptionCycleId: (value as any)?.subscriptionCycleId ? String((value as any).subscriptionCycleId) : undefined,
    subscriptionCycleStartedAt: toIsoOrUndefined((value as any)?.subscriptionCycleStartedAt),
    subscriptionCycleEndsAt: toIsoOrUndefined((value as any)?.subscriptionCycleEndsAt),
    subscriptionOriginalTransactionId: (value as any)?.subscriptionOriginalTransactionId ? String((value as any).subscriptionOriginalTransactionId) : undefined,
    lastSubscriptionPurchaseAt: toIsoOrUndefined((value as any)?.lastSubscriptionPurchaseAt),
    billingIssueDetectedAt: toIsoOrUndefined((value as any)?.billingIssueDetectedAt),
    gracePeriodEndsAt: toIsoOrUndefined((value as any)?.gracePeriodEndsAt),
    toolFreeTrials: normalizeToolTrials((value as any)?.toolFreeTrials),
    transactions: normalizeTransactions((value as any)?.transactions),
    holds: normalizeRecordMap<JobHold>((value as any)?.holds),
    jobs: normalizeRecordMap<AiJobRecord>((value as any)?.jobs),
    processedPurchases: normalizeRecordMap<string>((value as any)?.processedPurchases),
    processedPurchaseFingerprints: normalizeRecordMap<string>((value as any)?.processedPurchaseFingerprints),
    processedWebhookEvents: normalizeRecordMap<string>((value as any)?.processedWebhookEvents),
    reversedPurchases: normalizeRecordMap<string>((value as any)?.reversedPurchases),
  }]));
  const devices = Object.fromEntries(Object.entries(parsed?.devices || {}).map(([key, value]) => [key, {
    freeTrials: normalizeTrialCounts((value as any)?.freeTrials),
    toolFreeTrials: normalizeToolTrials((value as any)?.toolFreeTrials),
  }]));
  const ipTrials = Object.fromEntries(Object.entries(parsed?.ipTrials || {}).map(([key, value]) => [key, normalizeTrialCounts(value)]));
  const ipToolTrials = Object.fromEntries(Object.entries(parsed?.ipToolTrials || {}).map(([key, value]) => [key, normalizeToolTrials(value)]));
  return { accounts, devices, ipTrials, ipToolTrials };
}

function serialiseUsageStore(store: UsageStore): UsageStore {
  return JSON.parse(JSON.stringify(normalizeUsageStore(store))) as UsageStore;
}

let localStoreMutationQueue: Promise<void> = Promise.resolve();

async function loadStoreDirect(): Promise<UsageStore> {
  if (FIREBASE_ADMIN_READY && !FORCE_LOCAL_USAGE_STORE) {
    try {
      const storeDoc = getFirestore().collection(USAGE_STORE_COLLECTION).doc(USAGE_STORE_DOC_ID);
      const snapshot = await storeDoc.get();
      if (snapshot.exists) return normalizeUsageStore(snapshot.data() as UsageStore);
      const initial = createEmptyStore();
      await storeDoc.set(initial);
      return initial;
    } catch (error) {
      console.warn("Firestore usage store unavailable; falling back to local development store.", error);
    }
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as UsageStore;
    return normalizeUsageStore(parsed);
  } catch {
    const initial = createEmptyStore();
    await fs.writeFile(STORE_PATH, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }
}

async function saveStoreDirect(store: UsageStore) {
  const serialisedStore = serialiseUsageStore(store);

  if (FIREBASE_ADMIN_READY && !FORCE_LOCAL_USAGE_STORE) {
    try {
      await getFirestore().collection(USAGE_STORE_COLLECTION).doc(USAGE_STORE_DOC_ID).set(serialisedStore);
      return;
    } catch (error) {
      console.warn("Firestore usage store save failed; falling back to local development store.", error);
    }
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(serialisedStore, null, 2), "utf8");
}

async function ensureStore(): Promise<UsageStore> {
  return await loadStoreDirect();
}

async function saveStore(store: UsageStore) {
  await saveStoreDirect(store);
}

async function mutateUsageStore<T>(mutator: (store: UsageStore) => Promise<T> | T): Promise<T> {
  if (FIREBASE_ADMIN_READY && !FORCE_LOCAL_USAGE_STORE) {
    const db = getFirestore();
    const ref = db.collection(USAGE_STORE_COLLECTION).doc(USAGE_STORE_DOC_ID);
    return await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const store = snapshot.exists ? normalizeUsageStore(snapshot.data() as UsageStore) : createEmptyStore();
      const result = await mutator(store);
      transaction.set(ref, serialiseUsageStore(store));
      return result;
    });
  }

  const previous = localStoreMutationQueue.catch(() => undefined);
  let releaseQueue!: () => void;
  localStoreMutationQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  await previous;

  try {
    const store = await loadStoreDirect();
    const result = await mutator(store);
    await saveStoreDirect(store);
    return result;
  } finally {
    releaseQueue();
  }
}

function hashValue(value: string) {
  return crypto.createHash("sha256").update(`${HASH_SALT}:${value}`).digest("hex");
}

function getIpAddress(req: express.Request) {
  const forwarded = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return forwarded || req.ip || req.socket.remoteAddress || "unknown";
}

function getAccountKey(uid?: string | null) {
  return uid ? `acct:${hashValue(uid)}` : null;
}

function getDeviceKey(deviceId?: string | null) {
  return deviceId ? `device:${hashValue(deviceId)}` : null;
}

function getOrCreateAccountRecord(store: UsageStore, accountKey: string): AccountRecord {
  const existing = store.accounts[accountKey];
  if (existing) {
    existing.credits = { ...emptyCredits(), ...(existing.credits || {}) };
    existing.freeTrials = normalizeTrialCounts(existing.freeTrials);
    existing.toolFreeTrials = normalizeToolTrials(existing.toolFreeTrials);
    existing.transactions = normalizeTransactions(existing.transactions);
    existing.holds = normalizeRecordMap<JobHold>(existing.holds);
    existing.jobs = normalizeRecordMap<AiJobRecord>(existing.jobs);
    existing.processedPurchases = normalizeRecordMap<string>(existing.processedPurchases);
    existing.processedPurchaseFingerprints = normalizeRecordMap<string>(existing.processedPurchaseFingerprints);
    existing.processedWebhookEvents = normalizeRecordMap<string>(existing.processedWebhookEvents);
    existing.reversedPurchases = normalizeRecordMap<string>(existing.reversedPurchases);
    existing.walletCents = Math.round(Number(existing.walletCents) || 0);
    existing.proEntitlementActive = Boolean(existing.proEntitlementActive);
    existing.proMonthlyCreditAllowance = Math.max(0, Number(existing.proMonthlyCreditAllowance) || PRO_MONTHLY_AI_CREDITS);
    existing.proCredits = Math.max(0, Number(existing.proCredits) || 0);
    existing.premiumUsage = { ...emptyPremiumUsage(), ...(existing.premiumUsage || {}) };
    if (existing.premiumUsageMonth !== currentMonthKey()) {
      existing.premiumUsage = emptyPremiumUsage();
      existing.premiumUsageMonth = currentMonthKey();
    }
    existing.subscriptionStatus = normalizeSubscriptionStatus(existing.subscriptionStatus, existing.proEntitlementActive ? "active" : "inactive");
    existing.subscriptionCycleStartedAt = toIsoOrUndefined(existing.subscriptionCycleStartedAt);
    existing.subscriptionCycleEndsAt = toIsoOrUndefined(existing.subscriptionCycleEndsAt);
    existing.lastSubscriptionPurchaseAt = toIsoOrUndefined(existing.lastSubscriptionPurchaseAt);
    existing.billingIssueDetectedAt = toIsoOrUndefined(existing.billingIssueDetectedAt);
    existing.gracePeriodEndsAt = toIsoOrUndefined(existing.gracePeriodEndsAt);
    ensureSubscriptionStateFresh(existing);
    cleanupStaleAiJobs(existing);
    return existing;
  }
  const created: AccountRecord = {
    credits: emptyCredits(),
    premiumUsage: emptyPremiumUsage(),
    premiumUsageMonth: currentMonthKey(),
    freeTrials: emptyTrialCounts(),
    walletCents: 0,
    proCredits: 0,
    proCreditsMonth: currentMonthKey(),
    proEntitlementActive: false,
    proMonthlyCreditAllowance: PRO_MONTHLY_AI_CREDITS,
    subscriptionStatus: "inactive",
    toolFreeTrials: emptyToolTrials(),
    transactions: [],
    holds: {},
    jobs: {},
    processedPurchases: {},
    processedPurchaseFingerprints: {},
    processedWebhookEvents: {},
    reversedPurchases: {},
  };
  store.accounts[accountKey] = created;
  return created;
}

function getOrCreateDeviceRecord(store: UsageStore, deviceKey: string): DeviceRecord {
  const existing = store.devices[deviceKey];
  if (existing) {
    existing.freeTrials = normalizeTrialCounts(existing.freeTrials);
    existing.toolFreeTrials = normalizeToolTrials(existing.toolFreeTrials);
    return existing;
  }
  const created: DeviceRecord = { freeTrials: emptyTrialCounts(), toolFreeTrials: emptyToolTrials() };
  store.devices[deviceKey] = created;
  return created;
}

async function purgeAccountData(uid: string) {
  const accountKey = getAccountKey(uid);
  if (!accountKey) return;

  await mutateUsageStore((store) => {
    delete store.accounts[`uid:${uid}`];
    delete store.accounts[accountKey];
  });
}

async function deleteFirebaseAccountData(uid: string) {
  if (!FIREBASE_ADMIN_READY) {
    throw new Error("Authenticated account deletion is not configured on the server.");
  }

  const adminDb = getFirestore();
  const userRef = adminDb.collection("users").doc(uid);
  const userProjects = await adminDb.collection("projects").where("userId", "==", uid).get();

  if (!userProjects.empty) {
    const batch = adminDb.batch();
    userProjects.docs.forEach((projectDoc) => batch.delete(projectDoc.ref));
    batch.delete(userRef);
    await batch.commit();
  } else {
    await userRef.delete().catch(() => undefined);
  }

  await purgeAccountData(uid);
  await getAuth().deleteUser(uid);
}

function applyNoStore(res: express.Response) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function buildSnapshot(store: UsageStore, accountKey: string | null, deviceKey: string | null, ipHash: string) {
  const account = accountKey ? getOrCreateAccountRecord(store, accountKey) : null;
  const device = deviceKey ? getOrCreateDeviceRecord(store, deviceKey) : null;
  const ipTrials = store.ipTrials[ipHash] || emptyTrialCounts();
  if (account) ensureSubscriptionStateFresh(account);

  const credits = account?.credits || emptyCredits();
  const remainingPremiumUses = {
    photo: PREMIUM_LIMITS.photo - (account?.premiumUsage.photo || 0),
    video: PREMIUM_LIMITS.video - (account?.premiumUsage.video || 0),
    design: PREMIUM_LIMITS.design - (account?.premiumUsage.design || 0),
    business: PREMIUM_LIMITS.business - (account?.premiumUsage.business || 0),
  };

  const freeTrialRemaining = {
    photo: Math.max(0, FREE_TRIAL_LIMIT - Math.max(account?.freeTrials.photo || 0, device?.freeTrials.photo || 0, ipTrials.photo || 0)) > 0,
    video: Math.max(0, FREE_TRIAL_LIMIT - Math.max(account?.freeTrials.video || 0, device?.freeTrials.video || 0, ipTrials.video || 0)) > 0,
    design: Math.max(0, FREE_TRIAL_LIMIT - Math.max(account?.freeTrials.design || 0, device?.freeTrials.design || 0, ipTrials.design || 0)) > 0,
    business: Math.max(0, FREE_TRIAL_LIMIT - Math.max(account?.freeTrials.business || 0, device?.freeTrials.business || 0, ipTrials.business || 0)) > 0,
  };

  const ipToolTrials = store.ipToolTrials?.[ipHash] || emptyToolTrials();
  const toolTrialRemaining = Object.fromEntries(TOOL_CONFIGS.map((tool) => [
    tool.internalId,
    tool.trialEligible && Math.max(
      account?.toolFreeTrials?.[tool.internalId] || 0,
      device?.toolFreeTrials?.[tool.internalId] || 0,
      ipToolTrials[tool.internalId] || 0,
    ) < FREE_TRIAL_LIMIT,
  ]));
  const walletCentsRaw = Math.round(Number(account?.walletCents) || 0);
  const walletBalanceCents = Math.max(0, walletCentsRaw);
  const walletDebtCents = Math.max(0, -walletCentsRaw);
  const subscriptionPlan = getSubscriptionPlanForAccount(account);
  const resolvedTier = resolveUserTier(account);
  const subscriptionStatus = normalizeSubscriptionStatus(account?.subscriptionStatus, account?.proEntitlementActive ? "active" : "inactive");

  return {
    tier: resolvedTier,
    credits,
    wallet: {
      balanceCents: walletBalanceCents,
      balanceZar: centsToZar(walletBalanceCents),
      debtCents: walletDebtCents,
      debtZar: centsToZar(walletDebtCents),
      proCreditsRemaining: Math.max(0, account?.proCredits || 0),
      subscription: subscriptionPlan ? {
        planId: subscriptionPlan.planId,
        displayName: subscriptionPlan.displayName,
        monthlyZar: subscriptionPlan.monthlyZar,
        monthlyAiCredits: subscriptionPlan.monthlyAiCredits,
        status: subscriptionStatus,
        isActive: Boolean(account?.proEntitlementActive && subscriptionStatusAllowsAccess(subscriptionStatus)),
        cycleStartedAt: account?.subscriptionCycleStartedAt || null,
        cycleEndsAt: getEffectiveSubscriptionEndAt(account),
        originalTransactionId: account?.subscriptionOriginalTransactionId || null,
        billingIssueDetectedAt: account?.billingIssueDetectedAt || null,
        gracePeriodEndsAt: account?.gracePeriodEndsAt || null,
        hasPriorityProcessing: hasPriorityProcessing(account),
      } : null,
    },
    transactionHistory: normalizeTransactions(account?.transactions).slice(-50).reverse(),
    freeTrialRemaining,
    toolTrialRemaining,
    remainingPremiumUses,
    pricing: {
      exchangeRate: EXCHANGE_RATE,
      premiumMonthlyZar: PREMIUM_MONTHLY_ZAR,
      subscriptionPlans: SUBSCRIPTION_PLANS.map((plan) => ({
        planId: plan.planId,
        displayName: plan.displayName,
        monthlyZar: plan.monthlyZar,
        monthlyAiCredits: plan.monthlyAiCredits,
        productId: plan.productId,
      })),
      bundleZar: {
        photo: 0,
        video: 0,
        design: 0,
        business: 0,
      },
      aiTiers: AI_PRICE_TIERS,
    },
  };
}

async function syncBillingTierToFirebase(uid: string, account: AccountRecord | null) {
  if (!FIREBASE_ADMIN_READY || !uid) return;

  try {
    await getFirestore().collection("users").doc(uid).set({
      tier: resolveUserTier(account),
    }, { merge: true });
  } catch (error) {
    console.warn("Could not sync billing tier to Firestore user profile.", error);
  }
}

type VerifiedIdentity = {
  uid: string;
  email?: string | null;
};

async function getVerifiedIdentity(req: express.Request): Promise<VerifiedIdentity | null> {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const bodyUid = typeof req.body?.uid === "string" ? req.body.uid.trim() : "";
  const isLocalRequest = ["127.0.0.1", "::1", "localhost"].includes(req.hostname || "") || (req.ip || "").includes("127.0.0.1") || (req.ip || "") === "::1";

  if (!token) {
    if (!ALLOW_INSECURE_UID_FALLBACK || !bodyUid || !isLocalRequest) {
      return null;
    }
    console.warn("Using insecure UID fallback for local development only.");
    return { uid: bodyUid };
  }

  if (!FIREBASE_ADMIN_READY) {
    if (!ALLOW_INSECURE_UID_FALLBACK || !bodyUid || !isLocalRequest) {
      return null;
    }
    console.warn("Firebase Admin not ready; using insecure UID fallback for local development only.");
    return { uid: bodyUid };
  }

  try {
    const decoded = await getAuth().verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email || null };
  } catch {
    return null;
  }
}

async function getVerifiedUid(req: express.Request) {
  return (await getVerifiedIdentity(req))?.uid || null;
}

async function requireVerifiedIdentity(req: express.Request, res: express.Response) {
  const identity = await getVerifiedIdentity(req);
  if (!identity?.uid) {
    res.status(401).json({ error: "Login verification is required for wallet, credits, and AI generation." });
    return null;
  }
  return identity;
}

async function requireVerifiedUid(req: express.Request, res: express.Response) {
  return (await requireVerifiedIdentity(req, res))?.uid || null;
}

function addLedgerTransaction(account: AccountRecord, transaction: Omit<LedgerTransaction, "id" | "createdAt"> & { id?: string; createdAt?: string }) {
  const transactions = normalizeTransactions(account.transactions);
  transactions.push({
    id: transaction.id || makeId("tx"),
    createdAt: transaction.createdAt || nowIso(),
    type: transaction.type,
    amountCents: transaction.amountCents,
    toolId: transaction.toolId,
    toolName: transaction.toolName,
    jobId: transaction.jobId,
    source: transaction.source,
    productId: transaction.productId,
    note: transaction.note,
  });
  account.transactions = transactions.slice(-LEDGER_LIMIT);
}

function cleanupStaleAiJobs(account: AccountRecord) {
  const jobs = normalizeRecordMap<AiJobRecord>(account.jobs);
  const holds = normalizeRecordMap<JobHold>(account.holds);
  const staleBefore = Date.now() - AI_JOB_STALE_MS;

  Object.values(jobs).forEach((job) => {
    if (job.status !== "queued" && job.status !== "processing") return;

    const touchedAt = toMillis(job.updatedAt || job.createdAt) || 0;
    if (touchedAt > staleBefore) return;

    const hold = holds[job.holdId];
    if (hold?.status === "held") {
      if (hold.source === "pro_credit") {
        account.proCredits = Math.max(0, (account.proCredits || 0) + (hold.proCreditCost || 1));
      } else if (hold.source === "wallet") {
        account.walletCents = Math.round(Number(account.walletCents) || 0) + hold.amountCents;
      }

      hold.status = "released";
      hold.releasedAt = nowIso();
      addLedgerTransaction(account, {
        type: "release",
        amountCents: 0,
        toolId: hold.toolId,
        toolName: hold.toolName,
        jobId: job.id,
        source: hold.source,
        note: "A stalled AI request was automatically released after timing out.",
      });
    }

    job.status = "failed";
    job.updatedAt = nowIso();
    job.error = "AI request timed out before completion.";
  });

  account.holds = holds;
  account.jobs = jobs;
}

function ensureProCreditsForCycle(account: AccountRecord) {
  ensureSubscriptionStateFresh(account);
  if (!account.proEntitlementActive) return;
  const monthlyAllowance = Math.max(1, Number(account.proMonthlyCreditAllowance) || PRO_MONTHLY_AI_CREDITS);
  if (typeof account.proCredits !== "number" || account.proCredits < 0) {
    account.proCredits = monthlyAllowance;
  }
  if (account.proCredits > monthlyAllowance) {
    account.proCredits = monthlyAllowance;
  }
}

function isFreeTestRequest(req: express.Request, identity: VerifiedIdentity) {
  if (!FREE_TEST_MODE || String(req.headers["x-chromancy-free-test"] || "") !== "1") return false;
  if (!FREE_TEST_ALLOWLIST_CONFIGURED) {
    console.warn("CHROMANCY_FREE_TEST_MODE is enabled, but no CHROMANCY_FREE_TEST_UIDS or CHROMANCY_FREE_TEST_EMAILS allowlist is configured. Free-test bypass was denied.");
    return false;
  }
  const email = identity.email?.trim().toLowerCase();
  return FREE_TEST_ALLOWED_UIDS.has(identity.uid) || Boolean(email && FREE_TEST_ALLOWED_EMAILS.has(email));
}

function getActiveJobCount(account: AccountRecord) {
  return Object.values(normalizeRecordMap<AiJobRecord>(account.jobs)).filter((job) => job.status === "queued" || job.status === "processing").length;
}

const aiRateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkAiRateLimit(key: string, maxJobs = RATE_LIMIT_MAX_AI_JOBS) {
  const now = Date.now();
  const existing = aiRateBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    aiRateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  existing.count += 1;
  return existing.count <= maxJobs;
}

function sanitizeCrashText(value: unknown, maxLength = 1600) {
  return String(value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key|token|secret|password)["'\s:=]+[A-Za-z0-9._~+/=-]+/gi, "$1=[redacted]")
    .slice(0, maxLength);
}

function sanitizeCrashContext(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  try {
    return JSON.parse(sanitizeCrashText(JSON.stringify(value), 2400));
  } catch {
    return { note: "Context was omitted because it could not be sanitized safely." };
  }
}

async function writeClientCrashReport(report: Record<string, unknown>) {
  if (FIREBASE_ADMIN_READY && !FORCE_LOCAL_USAGE_STORE) {
    await getFirestore().collection("client_crashes").add(report);
    return;
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.appendFile(
    path.join(DATA_DIR, "client-crashes.jsonl"),
    `${JSON.stringify(report)}\n`,
    "utf8",
  );
}

async function createAiHold(req: express.Request, res: express.Response, toolId: string, options: { tier?: UserTier; retryOfJobId?: string | null } = {}) {
  const tool = getToolConfig(toolId);
  if (!tool) {
    res.status(400).json({ error: "Unknown AI tool." });
    return null;
  }

  if (!tool.isAi || tool.pricingTier === "free") {
    return {
      store: await ensureStore(),
      accountKey: null as string | null,
      account: null as AccountRecord | null,
      hold: null as JobHold | null,
      job: null as AiJobRecord | null,
      tool,
      uid: null as string | null,
      deviceKey: null as string | null,
      ipHash: "",
    };
  }

  const identity = await requireVerifiedIdentity(req, res);
  if (!identity) return null;
  const uid = identity.uid;

  if (isFreeTestRequest(req, identity)) {
    return {
      store: await ensureStore(),
      accountKey: null as string | null,
      account: null as AccountRecord | null,
      hold: null as JobHold | null,
      job: null as AiJobRecord | null,
      tool,
      uid,
      deviceKey: getDeviceKey(req.body?.deviceId),
      ipHash: hashValue(getIpAddress(req)),
    };
  }

  if (req.body?.spendConfirmed !== true) {
    res.status(409).json({ error: `Please confirm the ${tool.displayName} AI spend before generating.` });
    return null;
  }

  const holdContext = await mutateUsageStore((store) => {
    const accountKey = getAccountKey(uid)!;
    const deviceKey = getDeviceKey(req.body?.deviceId);
    const ipHash = hashValue(getIpAddress(req));
    const account = getOrCreateAccountRecord(store, accountKey);
    const device = deviceKey ? getOrCreateDeviceRecord(store, deviceKey) : null;
    store.ipToolTrials = store.ipToolTrials || {};
    const ipToolTrials = store.ipToolTrials[ipHash] || emptyToolTrials();
    store.ipToolTrials[ipHash] = ipToolTrials;
    ensureProCreditsForCycle(account);
    const subscriberTier = resolveUserTier(account);

    const rateKey = accountKey || deviceKey || ipHash;
    const priorityProcessing = hasPriorityProcessing(account);
    const maxRateLimitedJobs = priorityProcessing ? RATE_LIMIT_MAX_AI_JOBS * 2 : RATE_LIMIT_MAX_AI_JOBS;
    if (!checkAiRateLimit(rateKey, maxRateLimitedJobs)) {
      return { errorStatus: 429, error: "Too many AI requests. Please wait a moment before trying again." };
    }

    const maxConcurrentJobs = priorityProcessing ? MAX_CONCURRENT_JOBS + 3 : MAX_CONCURRENT_JOBS;
    if (getActiveJobCount(account) >= maxConcurrentJobs) {
      return { errorStatus: 429, error: "Please wait for your current AI generation to finish before starting another." };
    }

    const activeSameToolJob = Object.values(normalizeRecordMap<AiJobRecord>(account.jobs)).find((job) =>
      job.toolId === tool.internalId && (job.status === "queued" || job.status === "processing")
    );
    if (activeSameToolJob) {
      return {
        errorStatus: 409,
        error: `${tool.displayName} is already generating. Please wait for it to finish before starting it again.`,
      };
    }

    const isRetry = !!options.retryOfJobId;
    const amountCents = getToolPriceCents(tool.internalId, isRetry);
    const proCreditCost = getToolProCreditCost(tool.internalId, isRetry);
    const expectedWalletSpendCents = Number(req.body?.expectedWalletSpendCents);
    const expectedProCreditCost = Number(req.body?.expectedProCreditCost);
    let source: FundingSource = "wallet";

    if (Number.isFinite(expectedWalletSpendCents) && Math.round(expectedWalletSpendCents) !== amountCents) {
      return {
        errorStatus: 409,
        error: `Pricing for ${tool.displayName} is out of sync. Please refresh the app and try again.`,
      };
    }

    if (Number.isFinite(expectedProCreditCost) && Math.round(expectedProCreditCost) !== proCreditCost) {
      return {
        errorStatus: 409,
        error: `Subscription-credit pricing for ${tool.displayName} is out of sync. Please refresh the app and try again.`,
      };
    }

    const currentTrialCount = Math.max(
      account.toolFreeTrials?.[tool.internalId] || 0,
      device?.toolFreeTrials?.[tool.internalId] || 0,
      ipToolTrials[tool.internalId] || 0,
    );

    if ((subscriberTier === "pro" || subscriberTier === "premium") && (account.proCredits || 0) >= proCreditCost) {
      source = "pro_credit";
    } else if ((subscriberTier !== "pro" && subscriberTier !== "premium") && !options.retryOfJobId && tool.trialEligible && currentTrialCount < FREE_TRIAL_LIMIT) {
      source = "trial";
    } else if ((account.walletCents || 0) >= amountCents) {
      source = "wallet";
    } else {
      const snapshot = buildSnapshot(store, accountKey, deviceKey, ipHash);
      const trialFinished = tool.trialEligible && currentTrialCount >= FREE_TRIAL_LIMIT;
      const hasSubscription = subscriberTier === "pro" || subscriberTier === "premium";
      const creditBalance = Math.max(0, Number(account.proCredits) || 0);
      const walletBalance = centsToZar(Math.max(0, account.walletCents || 0));
      const walletDebt = centsToZar(Math.max(0, -(account.walletCents || 0)));
      const priceZar = centsToZar(amountCents);
      const creditText = proCreditCost === 1 ? "1 credit" : `${proCreditCost} credits`;
      const prefix = trialFinished
        ? `Your free trial for ${tool.displayName} is finished.`
        : `You do not have enough AI access for ${tool.displayName}.`;
      const entitlementMessage = hasSubscription
        ? `${prefix} This tool needs ${creditText}, but you have ${creditBalance} subscription credit${creditBalance === 1 ? "" : "s"} left and R${walletBalance.toFixed(2)} in your wallet${walletDebt > 0 ? `, with R${walletDebt.toFixed(2)} still owed from a refunded top-up` : ""}. Please top up your wallet to continue.`
        : `${prefix} This tool costs R${priceZar.toFixed(2)} or ${creditText}. Please top up your wallet or subscribe to continue.`;
      return {
        errorStatus: 402,
        error: entitlementMessage,
        snapshot,
      };
    }

    if (source === "trial") {
      const next = currentTrialCount + 1;
      account.toolFreeTrials = { ...emptyToolTrials(), ...(account.toolFreeTrials || {}), [tool.internalId]: next };
      if (device) device.toolFreeTrials = { ...emptyToolTrials(), ...(device.toolFreeTrials || {}), [tool.internalId]: next };
      ipToolTrials[tool.internalId] = next;
    } else if (source === "pro_credit") {
      account.proCredits = Math.max(0, (account.proCredits || 0) - proCreditCost);
    } else if (source === "wallet") {
      account.walletCents = Math.round(Number(account.walletCents) || 0) - amountCents;
    }

    const hold: JobHold = {
      id: makeId("hold"),
      createdAt: nowIso(),
      status: "held",
      toolId: tool.internalId,
      toolName: tool.displayName,
      amountCents,
      proCreditCost,
      source,
      isRetry,
      originalJobId: options.retryOfJobId || undefined,
      idempotencyKey: typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey : undefined,
    };
    const job: AiJobRecord = {
      id: makeId("job"),
      createdAt: hold.createdAt,
      updatedAt: hold.createdAt,
      status: "queued",
      toolId: hold.toolId,
      toolName: hold.toolName,
      amountCents: hold.amountCents,
      source: hold.source,
      holdId: hold.id,
    };

    account.holds = { ...normalizeRecordMap<JobHold>(account.holds), [hold.id]: hold };
    account.jobs = { ...normalizeRecordMap<AiJobRecord>(account.jobs), [job.id]: job };
    addLedgerTransaction(account, {
      type: "hold",
      amountCents: source === "wallet" ? -amountCents : 0,
      toolId: hold.toolId,
      toolName: hold.toolName,
      jobId: job.id,
      source,
      note: source === "trial"
        ? "Free trial reserved before generation started"
        : source === "pro_credit"
          ? `${proCreditCost} AI Subscription Credit${proCreditCost === 1 ? "" : "s"} charged before generation started`
          : "Wallet funds charged before generation started",
    });

    return { store, accountKey, account, hold, job, tool, uid, deviceKey, ipHash };
  });

  if ((holdContext as any)?.errorStatus) {
    const failure = holdContext as { errorStatus: number; error: string; snapshot?: unknown };
    res.status(failure.errorStatus).json({
      error: failure.error,
      ...(failure.snapshot ? { snapshot: failure.snapshot } : {}),
    });
    return null;
  }

  return holdContext as any;
}

async function finalizeAiHold(context: Awaited<ReturnType<typeof createAiHold>> | null) {
  if (!context?.account || !context.hold || !context.job) return;
  await mutateUsageStore((store) => {
    const account = getOrCreateAccountRecord(store, context.accountKey!);
    const hold = account.holds?.[context.hold.id];
    const job = account.jobs?.[context.job.id];
    if (!hold || !job || hold.status !== "held") return;
    hold.status = "finalized";
    hold.finalizedAt = nowIso();
    job.status = "success";
    job.updatedAt = hold.finalizedAt;
    job.resultAvailable = true;
    addLedgerTransaction(account, {
      type: hold.isRetry ? "retry" : "usage",
      amountCents: 0,
      toolId: hold.toolId,
      toolName: hold.toolName,
      jobId: job.id,
      source: hold.source,
      note: hold.source === "trial"
        ? "Generation completed; free trial kept"
        : hold.source === "pro_credit"
          ? `Generation completed; ${hold.proCreditCost || 1} AI Subscription Credit${(hold.proCreditCost || 1) === 1 ? "" : "s"} kept`
          : "Generation completed; upfront wallet charge kept",
    });
  });
}

async function markAiJobProcessing(context: Awaited<ReturnType<typeof createAiHold>> | null) {
  if (!context?.account || !context.job) return;
  await mutateUsageStore((store) => {
    const account = getOrCreateAccountRecord(store, context.accountKey!);
    const job = account.jobs?.[context.job.id];
    if (!job) return;
    job.status = "processing";
    job.updatedAt = nowIso();
  });
}

async function releaseAiHold(context: Awaited<ReturnType<typeof createAiHold>> | null, reason: string) {
  if (!context?.account || !context.hold || !context.job) return;
  await mutateUsageStore((store) => {
    const account = getOrCreateAccountRecord(store, context.accountKey!);
    const hold = account.holds?.[context.hold.id];
    const job = account.jobs?.[context.job.id];
    if (!hold || !job || hold.status !== "held") return;

    if (hold.source === "trial") {
      account.toolFreeTrials = { ...emptyToolTrials(), ...(account.toolFreeTrials || {}), [hold.toolId]: Math.max(0, (account.toolFreeTrials?.[hold.toolId] || 0) - 1) };
      if (context.deviceKey) {
        const device = getOrCreateDeviceRecord(store, context.deviceKey);
        device.toolFreeTrials = { ...emptyToolTrials(), ...(device.toolFreeTrials || {}), [hold.toolId]: Math.max(0, (device.toolFreeTrials?.[hold.toolId] || 0) - 1) };
      }
      if (context.ipHash) {
        store.ipToolTrials = store.ipToolTrials || {};
        const ipToolTrials = store.ipToolTrials[context.ipHash] || emptyToolTrials();
        ipToolTrials[hold.toolId] = Math.max(0, (ipToolTrials[hold.toolId] || 0) - 1);
        store.ipToolTrials[context.ipHash] = ipToolTrials;
      }
    } else if (hold.source === "pro_credit") {
      account.proCredits = Math.max(0, (account.proCredits || 0) + (hold.proCreditCost || 1));
    } else if (hold.source === "wallet") {
      account.walletCents = Math.round(Number(account.walletCents) || 0) + hold.amountCents;
    }

    hold.status = "released";
    hold.releasedAt = nowIso();
    job.status = "failed";
    job.updatedAt = hold.releasedAt;
    job.error = reason.slice(0, 300);
    addLedgerTransaction(account, {
      type: hold.source === "wallet" ? "refund" : "release",
      amountCents: hold.source === "wallet" ? hold.amountCents : 0,
      toolId: hold.toolId,
      toolName: hold.toolName,
      jobId: job.id,
      source: hold.source,
      note: hold.source === "trial"
        ? "Free trial restored because generation failed"
        : hold.source === "pro_credit"
          ? `${hold.proCreditCost || 1} AI Subscription Credit${(hold.proCreditCost || 1) === 1 ? "" : "s"} refunded because generation failed`
          : "Wallet funds refunded because generation failed",
    });
  });
}

function attachAiDisconnectGuard(req: express.Request, res: express.Response, context: Awaited<ReturnType<typeof createAiHold>> | null) {
  let cancelled = false;
  let cleanedUp = false;

  const handleDisconnect = () => {
    if (cleanedUp || cancelled || res.writableEnded || res.headersSent) return;
    cancelled = true;
    void releaseAiHold(context, "AI generation cancelled because the user left the screen or closed the app.");
  };

  req.on("aborted", handleDisconnect);
  req.on("close", handleDisconnect);
  res.on("close", handleDisconnect);

  return {
    wasCancelled() {
      return cancelled;
    },
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      req.off("aborted", handleDisconnect);
      req.off("close", handleDisconnect);
      res.off("close", handleDisconnect);
    },
  };
}

const WALLET_TOP_UP_BY_PRODUCT = Object.fromEntries(
  WALLET_TOP_UPS.map((topUp) => [topUp.productId, topUp]),
) as Record<string, typeof WALLET_TOP_UPS[number]>;

type RevenueCatWebhookEvent = {
  id: string;
  appUserId: string;
  originalAppUserId?: string;
  aliases: string[];
  productId: string;
  transactionId: string;
  originalTransactionId?: string;
  type: string;
  purchasedAt?: string;
  expirationAt?: string;
  gracePeriodExpirationAt?: string;
  eventTimestampAt?: string;
  cancelReason?: string;
  expirationReason?: string;
};

async function grantWalletTopUp(uid: string, productId: string, purchaseId: string, purchasedAt?: string | null) {
  const topUp = WALLET_TOP_UP_BY_PRODUCT[productId];
  if (!topUp) return { ok: false, reason: "UNKNOWN_PRODUCT" };
  const purchaseFingerprint = buildWalletPurchaseFingerprint(productId, purchasedAt);

  const result = await mutateUsageStore((store) => {
    const accountKey = getAccountKey(uid)!;
    const account = getOrCreateAccountRecord(store, accountKey);
    account.processedPurchases = normalizeRecordMap<string>(account.processedPurchases);
    account.processedPurchaseFingerprints = normalizeRecordMap<string>(account.processedPurchaseFingerprints);
    if (account.processedPurchases[purchaseId]) {
      return { ok: true, duplicate: true, snapshot: buildSnapshot(store, accountKey, null, hashValue("webhook")), account };
    }
    if (purchaseFingerprint && account.processedPurchaseFingerprints[purchaseFingerprint]) {
      account.processedPurchases[purchaseId] = productId;
      return { ok: true, duplicate: true, snapshot: buildSnapshot(store, accountKey, null, hashValue("webhook")), account };
    }

    const amountCents = zarToCents(topUp.zar);
    account.walletCents = Math.round(Number(account.walletCents) || 0) + amountCents;
    account.processedPurchases[purchaseId] = productId;
    if (purchaseFingerprint) {
      account.processedPurchaseFingerprints[purchaseFingerprint] = purchaseId;
    }
    addLedgerTransaction(account, {
      type: "top-up",
      amountCents,
      productId,
      note: `Wallet top-up ${productId}`,
    });
    return { ok: true, duplicate: false, snapshot: buildSnapshot(store, accountKey, null, hashValue("webhook")), account };
  });
  await syncBillingTierToFirebase(uid, result.account);
  return result;
}

async function reverseWalletTopUp(uid: string, productId: string, purchaseId: string, eventId: string, purchasedAt?: string | null) {
  const topUp = WALLET_TOP_UP_BY_PRODUCT[productId];
  if (!topUp) return { ok: false, reason: "UNKNOWN_PRODUCT" };
  const purchaseFingerprint = buildWalletPurchaseFingerprint(productId, purchasedAt);

  const result = await mutateUsageStore((store) => {
    const accountKey = getAccountKey(uid)!;
    const account = getOrCreateAccountRecord(store, accountKey);
    account.processedPurchases = normalizeRecordMap<string>(account.processedPurchases);
    account.processedPurchaseFingerprints = normalizeRecordMap<string>(account.processedPurchaseFingerprints);
    account.reversedPurchases = normalizeRecordMap<string>(account.reversedPurchases);

    const canonicalPurchaseId = account.processedPurchases[purchaseId]
      ? purchaseId
      : (purchaseFingerprint ? account.processedPurchaseFingerprints[purchaseFingerprint] : undefined);

    if (!canonicalPurchaseId) {
      return { ok: false, reason: "PURCHASE_NOT_GRANTED" };
    }

    if (account.reversedPurchases[canonicalPurchaseId]) {
      return { ok: true, duplicate: true, snapshot: buildSnapshot(store, accountKey, null, hashValue("webhook")), account };
    }

    const amountCents = zarToCents(topUp.zar);
    account.walletCents = Math.round(Number(account.walletCents) || 0) - amountCents;
    account.reversedPurchases[canonicalPurchaseId] = eventId;
    addLedgerTransaction(account, {
      type: "refund",
      amountCents: -amountCents,
      productId,
      note: `Wallet top-up reversed for ${productId}`,
    });
    return { ok: true, duplicate: false, snapshot: buildSnapshot(store, accountKey, null, hashValue("webhook")), account };
  });
  if ((result as any)?.account) {
    await syncBillingTierToFirebase(uid, (result as any).account);
  }
  return result;
}

function resolveSubscriptionStatusFromWebhook(event: RevenueCatWebhookEvent): SubscriptionStatus {
  const effectiveEndsAtMs = toMillis(event.gracePeriodExpirationAt || event.expirationAt || null);

  if (event.type === "EXPIRATION") return "expired";
  if (event.type === "BILLING_ISSUE") {
    return effectiveEndsAtMs && effectiveEndsAtMs <= Date.now() ? "expired" : "billing_issue";
  }
  if (event.type === "CANCELLATION") {
    return effectiveEndsAtMs && effectiveEndsAtMs > Date.now() ? "cancelled" : "expired";
  }

  return effectiveEndsAtMs && effectiveEndsAtMs <= Date.now() ? "expired" : "active";
}

function isSubscriptionCreditRefillEvent(eventType: string) {
  return eventType === "INITIAL_PURCHASE" || eventType === "RENEWAL" || eventType === "PRODUCT_CHANGE";
}

function isWalletTopUpGrantEvent(eventType: string) {
  return eventType === "NON_RENEWING_PURCHASE";
}

function isWalletTopUpReversalEvent(eventType: string) {
  return eventType === "CANCELLATION" || eventType === "REFUND";
}

async function applySubscriptionWebhook(uid: string, event: RevenueCatWebhookEvent) {
  const result = await mutateUsageStore((store) => {
    const accountKey = getAccountKey(uid)!;
    const account = getOrCreateAccountRecord(store, accountKey);
    const plan = getSubscriptionPlan(event.productId) || PRO_SUBSCRIPTION;
    account.processedWebhookEvents = normalizeRecordMap<string>(account.processedWebhookEvents);
    if (account.processedWebhookEvents[event.id]) {
      return { ok: true, duplicate: true, snapshot: buildSnapshot(store, accountKey, null, hashValue("webhook")), account };
    }

    const status = resolveSubscriptionStatusFromWebhook(event);
    const nextCycleStartedAt = event.purchasedAt || event.eventTimestampAt || account.subscriptionCycleStartedAt || nowIso();
    const nextCycleEndsAt = event.gracePeriodExpirationAt || event.expirationAt || account.subscriptionCycleEndsAt;
    const nextCycleId = buildSubscriptionCycleId(
      plan.revenueCatIdentifier,
      nextCycleStartedAt,
      nextCycleEndsAt,
      event.originalTransactionId || event.transactionId,
    );
    const shouldRefillCredits = isSubscriptionCreditRefillEvent(event.type) && nextCycleId !== account.subscriptionCycleId;

    account.proMonthlyCreditAllowance = plan.monthlyAiCredits;
    account.activeSubscriptionPlanId = plan.planId;
    account.activeSubscriptionProductId = plan.revenueCatIdentifier;
    account.subscriptionStatus = status;
    account.subscriptionCycleId = nextCycleId;
    account.subscriptionCycleStartedAt = nextCycleStartedAt;
    account.subscriptionCycleEndsAt = event.expirationAt || account.subscriptionCycleEndsAt;
    account.gracePeriodEndsAt = event.gracePeriodExpirationAt || undefined;
    account.subscriptionOriginalTransactionId = event.originalTransactionId || event.transactionId;
    account.lastSubscriptionPurchaseAt = event.purchasedAt || event.eventTimestampAt || account.lastSubscriptionPurchaseAt;
    account.billingIssueDetectedAt = event.type === "BILLING_ISSUE"
      ? (event.eventTimestampAt || nowIso())
      : undefined;
    account.proEntitlementActive = subscriptionStatusAllowsAccess(status);
    if (shouldRefillCredits) {
      account.proCredits = plan.monthlyAiCredits;
      addLedgerTransaction(account, {
        type: "top-up",
        amountCents: 0,
        productId: plan.revenueCatIdentifier,
        source: "pro_credit",
        note: `${plan.displayName} billing cycle started: ${plan.monthlyAiCredits} AI credits credited`,
      });
    } else if (!account.proEntitlementActive) {
      account.proCredits = 0;
    } else {
      account.proCredits = Math.min(Math.max(0, Number(account.proCredits) || 0), plan.monthlyAiCredits);
    }

    if (event.type === "BILLING_ISSUE") {
      addLedgerTransaction(account, {
        type: "release",
        amountCents: 0,
        productId: plan.revenueCatIdentifier,
        source: "pro_credit",
        note: `${plan.displayName} billing issue detected. Access remains active until the grace period ends.`,
      });
    } else if (event.type === "CANCELLATION") {
      addLedgerTransaction(account, {
        type: "release",
        amountCents: 0,
        productId: plan.revenueCatIdentifier,
        source: "pro_credit",
        note: `${plan.displayName} renewal was cancelled${event.cancelReason ? ` (${event.cancelReason.toLowerCase()})` : ""}. Access remains until the current billing period ends.`,
      });
    } else if (event.type === "EXPIRATION") {
      addLedgerTransaction(account, {
        type: "release",
        amountCents: 0,
        productId: plan.revenueCatIdentifier,
        source: "pro_credit",
        note: `${plan.displayName} expired${event.expirationReason ? ` (${event.expirationReason.toLowerCase()})` : ""}.`,
      });
    }
    account.processedWebhookEvents[event.id] = `${event.type}:${plan.revenueCatIdentifier}`;
    return { ok: true, duplicate: false, snapshot: buildSnapshot(store, accountKey, null, hashValue("webhook")), account };
  });
  await syncBillingTierToFirebase(uid, result.account);
  return result;
}

function getRevenueCatEventPayload(body: any) {
  const event = body?.event || body || {};
  const productId = event.product_id || event.product_identifier || event.store_product_id;
  const aliases = Array.isArray(event.aliases) ? event.aliases.filter((value: unknown) => typeof value === "string" && value.trim()).map((value: string) => value.trim()) : [];
  const appUserId = event.app_user_id || event.original_app_user_id || event.subscriber_attributes?.app_user_id?.value || aliases.find((value: string) => !isAnonymousRevenueCatId(value)) || aliases[0];
  const transactionId = event.transaction_id || event.original_transaction_id || event.id || makeId("rc");
  const type = String(event.type || event.event_type || "").toUpperCase();
  return {
    id: String(event.id || transactionId),
    appUserId: typeof appUserId === "string" ? appUserId : "",
    originalAppUserId: typeof event.original_app_user_id === "string" ? event.original_app_user_id : undefined,
    aliases,
    productId: typeof productId === "string" ? productId : "",
    transactionId: String(transactionId),
    originalTransactionId: typeof event.original_transaction_id === "string" ? event.original_transaction_id : undefined,
    type,
    purchasedAt: toIsoOrUndefined(event.purchased_at_ms || event.purchased_at),
    expirationAt: toIsoOrUndefined(event.expiration_at_ms || event.expiration_at),
    gracePeriodExpirationAt: toIsoOrUndefined(event.grace_period_expiration_at_ms || event.grace_period_expiration_at),
    eventTimestampAt: toIsoOrUndefined(event.event_timestamp_ms || event.event_timestamp),
    cancelReason: typeof event.cancel_reason === "string" ? event.cancel_reason : undefined,
    expirationReason: typeof event.expiration_reason === "string" ? event.expiration_reason : undefined,
  };
}

function getCustomerInfoSubscriptionCandidate(body: any) {
  const activeEntitlements = body?.entitlements && typeof body.entitlements === "object" ? body.entitlements : {};
  const entitlementValues = Object.values(activeEntitlements) as any[];
  const activeSubscriptions = Array.isArray(body?.activeSubscriptions) ? body.activeSubscriptions.filter((value: unknown): value is string => typeof value === "string") : [];
  const allExpirationDates = body?.allExpirationDates && typeof body.allExpirationDates === "object" ? body.allExpirationDates : {};
  const allPurchaseDates = body?.allPurchaseDates && typeof body.allPurchaseDates === "object" ? body.allPurchaseDates : {};

  const candidates: Array<{ productId: string; purchasedAt?: string; expirationAt?: string; originalTransactionId?: string }> = [];
  for (const entitlement of entitlementValues) {
    const baseProductId = typeof entitlement?.productIdentifier === "string" ? entitlement.productIdentifier : "";
    if (!baseProductId) continue;
    const planId = typeof entitlement?.productPlanIdentifier === "string" && entitlement.productPlanIdentifier
      ? `${baseProductId}:${entitlement.productPlanIdentifier}`
      : baseProductId;
    candidates.push({
      productId: planId,
      purchasedAt: toIsoOrUndefined(entitlement?.latestPurchaseDate || entitlement?.originalPurchaseDate || allPurchaseDates[planId] || allPurchaseDates[baseProductId]),
      expirationAt: toIsoOrUndefined(entitlement?.expirationDate || allExpirationDates[planId] || allExpirationDates[baseProductId]),
      originalTransactionId: typeof body?.originalAppUserId === "string" ? body.originalAppUserId : undefined,
    });
  }

  for (const productId of activeSubscriptions) {
    candidates.push({
      productId,
      purchasedAt: toIsoOrUndefined(allPurchaseDates[productId] || body?.requestDate),
      expirationAt: toIsoOrUndefined(allExpirationDates[productId]),
      originalTransactionId: typeof body?.originalAppUserId === "string" ? body.originalAppUserId : undefined,
    });
  }

  return candidates.find((candidate) => {
    const plan = getSubscriptionPlan(candidate.productId);
    if (!plan) return false;
    const expirationMs = toMillis(candidate.expirationAt || null);
    return !expirationMs || expirationMs > Date.now();
  }) || null;
}

async function syncCustomerInfoPurchases(uid: string, body: any) {
  const syncReason = typeof body?.reason === "string" ? body.reason : "app_refresh";
  const subscriptionCandidate = getCustomerInfoSubscriptionCandidate(body);
  if (subscriptionCandidate) {
    const plan = getSubscriptionPlan(subscriptionCandidate.productId) || PRO_SUBSCRIPTION;
    const purchasedAt = subscriptionCandidate.purchasedAt || toIsoOrUndefined(body?.requestDate) || nowIso();
    const transactionId = [
      "client_sync_subscription",
      plan.revenueCatIdentifier,
      purchasedAt,
      subscriptionCandidate.expirationAt || "no_expiration",
      subscriptionCandidate.originalTransactionId || uid,
    ].join(":");
    await applySubscriptionWebhook(uid, {
      id: transactionId,
      appUserId: uid,
      aliases: [],
      productId: subscriptionCandidate.productId,
      transactionId,
      originalTransactionId: subscriptionCandidate.originalTransactionId || transactionId,
      type: "INITIAL_PURCHASE",
      purchasedAt,
      expirationAt: subscriptionCandidate.expirationAt,
      eventTimestampAt: toIsoOrUndefined(body?.requestDate) || nowIso(),
    });
  }

  if (syncReason === "wallet_top_up") {
    const transactions = Array.isArray(body?.nonSubscriptionTransactions) ? body.nonSubscriptionTransactions : [];
    for (const [index, transaction] of transactions.entries()) {
      const productId = typeof transaction?.productIdentifier === "string" ? transaction.productIdentifier : "";
      if (!WALLET_TOP_UP_BY_PRODUCT[productId]) continue;
      const purchaseDate = toIsoOrUndefined(transaction?.purchaseDate) || undefined;
      const transactionId = String(
        transaction?.transactionIdentifier ||
        transaction?.purchaseToken ||
        `client_sync_wallet:${productId}:${purchaseDate || "unknown"}:${index}`,
      );
      await grantWalletTopUp(uid, productId, transactionId, purchaseDate);
    }
  }
}

async function startServer() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:", "blob:", "https:", "capacitor:"],
        mediaSrc: ["'self'", "data:", "blob:", "https:", "capacitor:"],
        connectSrc: ["'self'", "https:", "capacitor://localhost", "http://localhost:*", "https://localhost:*"],
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        workerSrc: ["'self'", "blob:"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: IS_PRODUCTION ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    referrerPolicy: { policy: "no-referrer" },
  }));

  const allowedOrigins = new Set([
    "capacitor://localhost",
    "ionic://localhost",
    "http://localhost",
    "https://localhost",
    "http://localhost:5173",
    "https://localhost:5173",
    "http://localhost:8100",
    "https://localhost:8100",
    "https://api.chromancy.online",
    "https://chromancy.online",
    "https://www.chromancy.online",
    "https://chromancy-699a7.firebaseapp.com",
    "https://chromancy-699a7.web.app",
  ]);
  const isAllowedOrigin = (origin: string) =>
    allowedOrigins.has(origin) || /^https?:\/\/localhost(?::\d+)?$/.test(origin);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (typeof origin === "string" && isAllowedOrigin(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    } else if (typeof origin === "string" && req.path.startsWith("/api/")) {
      return res.status(403).json({ error: "Origin is not allowed." });
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,Cache-Control,X-Chromancy-Free-Test,X-Requested-With");
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    next();
  });

  app.use(express.json({ limit: "60mb" }));

  app.use(["/api/ai", "/api/account", "/api/usage", "/api/billing", "/api/help-request", "/api/client-crash"], (_req, res, next) => {
    applyNoStore(res);
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      aiConfigured: AI_PROVIDER_CONFIGURED,
      aiProvider: AI_PROVIDER_NAME,
    });
  });

  app.post("/api/client-crash", async (req, res) => {
    if (!CLIENT_CRASH_LOGS_ENABLED) {
      return res.json({ ok: true, disabled: true });
    }

    const ipHash = hashValue(getIpAddress(req));
    if (!checkAiRateLimit(`client-crash:${ipHash}`, CLIENT_CRASH_RATE_LIMIT_MAX)) {
      return res.status(429).json({ error: "Too many crash reports." });
    }

    const identity = await getVerifiedIdentity(req).catch(() => null);
    const context = sanitizeCrashContext(req.body?.context);

    const report = {
      createdAt: nowIso(),
      userHash: identity?.uid ? hashValue(identity.uid) : null,
      ipHash,
      source: sanitizeCrashText(req.body?.source, 80),
      message: sanitizeCrashText(req.body?.message, 500),
      name: sanitizeCrashText(req.body?.name, 120),
      stack: sanitizeCrashText(req.body?.stack, 2400),
      route: sanitizeCrashText(req.body?.route, 220),
      platform: sanitizeCrashText(req.body?.platform, 80),
      userAgent: sanitizeCrashText(req.body?.userAgent, 500),
      appVersion: sanitizeCrashText(req.body?.appVersion, 80),
      context,
    };

    try {
      await writeClientCrashReport(report);
      return res.json({ ok: true });
    } catch (error) {
      console.error("Client crash report could not be stored", error);
      return res.status(500).json({ error: "Crash report could not be stored." });
    }
  });

  app.post("/api/usage/snapshot", async (req, res) => {
    const { deviceId } = req.body as { uid?: string | null; deviceId?: string | null; tier?: UserTier };
    const uid = await getVerifiedUid(req);
    const ipHash = hashValue(getIpAddress(req));
    const accountKey = getAccountKey(uid);
    const deviceKey = getDeviceKey(deviceId);
    const result = await mutateUsageStore((store) => {
      const snapshot = buildSnapshot(store, accountKey, deviceKey, ipHash);
      return {
        snapshot,
        account: uid && accountKey ? getOrCreateAccountRecord(store, accountKey) : null,
      };
    });
    if (uid && accountKey) {
      await syncBillingTierToFirebase(uid, result.account);
    }
    const snapshot = result.snapshot;
    res.json(snapshot);
  });

  app.get("/api/billing/transactions", async (req, res) => {
    const uid = await requireVerifiedUid(req, res);
    if (!uid) return;
    const accountKey = getAccountKey(uid)!;
    const account = await mutateUsageStore((store) => {
      const existing = getOrCreateAccountRecord(store, accountKey);
      ensureSubscriptionStateFresh(existing);
      return existing;
    });
    return res.json({
      transactions: normalizeTransactions(account.transactions).slice(-100).reverse(),
      wallet: {
        balanceCents: Math.max(0, account.walletCents || 0),
        balanceZar: centsToZar(Math.max(0, account.walletCents || 0)),
        debtCents: Math.max(0, -(account.walletCents || 0)),
        debtZar: centsToZar(Math.max(0, -(account.walletCents || 0))),
        proCreditsRemaining: Math.max(0, account.proCredits || 0),
      },
    });
  });

  app.post("/api/billing/revenuecat-webhook", async (req, res) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!REVENUECAT_WEBHOOK_SECRET && REQUIRE_REVENUECAT_WEBHOOK_SECRET) {
      return res.status(503).json({ error: "RevenueCat webhook secret is required in production." });
    }
    if (REVENUECAT_WEBHOOK_SECRET && token !== REVENUECAT_WEBHOOK_SECRET) {
      return res.status(401).json({ error: "Invalid webhook authorization." });
    }

    const event = getRevenueCatEventPayload(req.body);
    if (!event.appUserId || !event.productId) {
      return res.json({ ok: true, ignored: "missing_app_user_or_product" });
    }

    const subscriptionPlan = getSubscriptionPlan(event.productId);
    if (subscriptionPlan) {
      const result = await applySubscriptionWebhook(event.appUserId, event);
      return res.json({ ok: true, handled: `subscription_${event.type.toLowerCase()}`, duplicate: result.duplicate });
    }

    if (!WALLET_TOP_UP_BY_PRODUCT[event.productId]) {
      return res.json({ ok: true, ignored: event.productId });
    }

    if (isWalletTopUpReversalEvent(event.type)) {
      const reversed = await reverseWalletTopUp(event.appUserId, event.productId, event.transactionId, event.id, event.purchasedAt || event.eventTimestampAt);
      if (!reversed.ok) return res.json({ ok: true, ignored: reversed.reason || event.productId });
      return res.json({ ok: true, handled: "wallet_top_up_reversed", duplicate: "duplicate" in reversed ? reversed.duplicate : false });
    }

    if (!isWalletTopUpGrantEvent(event.type)) {
      return res.json({ ok: true, ignored: `wallet_${event.type.toLowerCase()}` });
    }

    const topUp = await grantWalletTopUp(event.appUserId, event.productId, event.transactionId, event.purchasedAt || event.eventTimestampAt);
    if (!topUp.ok) return res.json({ ok: true, ignored: event.productId });
    return res.json({ ok: true, handled: "wallet_top_up", duplicate: "duplicate" in topUp ? topUp.duplicate : false });
  });

  app.post("/api/billing/sync-customer-info", async (req, res) => {
    const uid = await requireVerifiedUid(req, res);
    if (!uid) return;

    try {
      await syncCustomerInfoPurchases(uid, req.body || {});
      const accountKey = getAccountKey(uid)!;
      const ipHash = hashValue(getIpAddress(req));
      const snapshot = await mutateUsageStore((store) => {
        const account = getOrCreateAccountRecord(store, accountKey);
        ensureSubscriptionStateFresh(account);
        return buildSnapshot(store, accountKey, getDeviceKey(req.body?.deviceId), ipHash);
      });
      return res.json(snapshot);
    } catch (error) {
      console.error("RevenueCat customer info sync failed", error);
      return res.status(500).json({ error: "Billing sync failed. Please wait a moment and try again." });
    }
  });

  app.post("/api/usage/consume-access", async (req, res) => {
    const verifiedUid = await getVerifiedUid(req);
    const { deviceId, category } = req.body as { uid?: string | null; deviceId?: string | null; category?: UnlockCategory; tier?: UserTier };
    if (!category || !CATEGORIES.includes(category)) return res.status(400).json({ error: "Invalid category." });

    const accountKey = getAccountKey(verifiedUid);
    const deviceKey = getDeviceKey(deviceId);
    const ipHash = hashValue(getIpAddress(req));
    const response = await mutateUsageStore((store) => {
      const snapshotBefore = buildSnapshot(store, accountKey, deviceKey, ipHash);

      if (accountKey) {
        const account = getOrCreateAccountRecord(store, accountKey);
        ensureSubscriptionStateFresh(account);
        const tier = resolveUserTier(account);
        if (tier === "pro" || tier === "premium") {
          if (snapshotBefore.remainingPremiumUses[category] <= 0) {
            return { ok: false, reason: `Premium ${category} uses are finished for this billing cycle.`, snapshot: snapshotBefore };
          }
          account.premiumUsage[category] += 1;
          return { ok: true, mode: "pro", snapshot: buildSnapshot(store, accountKey, deviceKey, ipHash) };
        }
      }

      if (accountKey) {
        const account = getOrCreateAccountRecord(store, accountKey);
        if (account.credits[category] > 0) {
          account.credits[category] -= 1;
          return { ok: true, mode: "wallet", snapshot: buildSnapshot(store, accountKey, deviceKey, ipHash) };
        }
      }

      const account = accountKey ? getOrCreateAccountRecord(store, accountKey) : null;
      const device = deviceKey ? getOrCreateDeviceRecord(store, deviceKey) : null;
      const ipTrials = store.ipTrials[ipHash] || emptyTrialCounts();
      store.ipTrials[ipHash] = ipTrials;

      const currentTrialCount = Math.max(account?.freeTrials[category] || 0, device?.freeTrials[category] || 0, ipTrials[category] || 0);

      if (currentTrialCount < FREE_TRIAL_LIMIT) {
        const nextTrialCount = currentTrialCount + 1;
        if (account) account.freeTrials[category] = nextTrialCount;
        if (device) device.freeTrials[category] = nextTrialCount;
        ipTrials[category] = nextTrialCount;
        return { ok: true, mode: "trial", snapshot: buildSnapshot(store, accountKey, deviceKey, ipHash) };
      }

      return {
        ok: false,
        reason: `Your free AI trial for ${category} is finished on this network or device. Top up your wallet or subscribe to Premium.`,
        snapshot: buildSnapshot(store, accountKey, deviceKey, ipHash),
      };
    });

    return res.json(response);
  });

  app.post("/api/account/purge", async (req, res) => {
    const verifiedUid = await requireVerifiedUid(req, res);
    if (!verifiedUid) return;
    const { uid } = req.body as { uid?: string | null };
    if (uid && uid !== verifiedUid) {
      return res.status(403).json({ error: "Account purge request does not match the logged-in user." });
    }

    await purgeAccountData(verifiedUid);
    return res.json({ ok: true });
  });

  app.post("/api/account/delete", async (req, res) => {
    const verifiedUid = await requireVerifiedUid(req, res);
    if (!verifiedUid) return;
    const { uid } = req.body as { uid?: string | null };
    if (uid && uid !== verifiedUid) {
      return res.status(403).json({ error: "Account deletion request does not match the logged-in user." });
    }

    try {
      await deleteFirebaseAccountData(verifiedUid);
      return res.json({ ok: true });
    } catch (error: any) {
      console.error("Account deletion failed", error);
      return res.status(500).json({ error: error?.message || "Account deletion failed on the server." });
    }
  });

  app.post("/api/ai/analyze-design", async (req, res) => {
    const { imageUrl, toolId = "design_critic", tier, retryOfJobId } = req.body as { imageUrl?: string; toolId?: string; tier?: UserTier; retryOfJobId?: string };

    if (!imageUrl) {
      return res.status(400).json({ error: "An image is required." });
    }

    const billing = await createAiHold(req, res, toolId, { tier, retryOfJobId });
    if (!billing) return;
    const disconnectGuard = attachAiDisconnectGuard(req, res, billing);

    try {
      await markAiJobProcessing(billing);
      const result = await analyzeDesignWithGemini(imageUrl);
      if (disconnectGuard.wasCancelled()) return;
      await finalizeAiHold(billing);
      if (disconnectGuard.wasCancelled()) return;
      return res.json(result);
    } catch (error: any) {
      if (disconnectGuard.wasCancelled()) return;
      await releaseAiHold(billing, error?.message || "Design analysis failed.");
      const failure = buildAiErrorResponse(error, "Design analysis failed.");
      return res.status(failure.status).json({ error: failure.error });
    } finally {
      disconnectGuard.cleanup();
    }
  });

  app.post("/api/ai/predict-performance", async (req, res) => {
    const { imageUrl, toolId = "smart_performance_predictor", tier, retryOfJobId } = req.body as { imageUrl?: string; toolId?: string; tier?: UserTier; retryOfJobId?: string };

    if (!imageUrl) {
      return res.status(400).json({ error: "An image is required." });
    }

    const billing = await createAiHold(req, res, toolId, { tier, retryOfJobId });
    if (!billing) return;
    const disconnectGuard = attachAiDisconnectGuard(req, res, billing);

    try {
      await markAiJobProcessing(billing);
      const result = await predictPerformanceWithGemini(imageUrl);
      if (disconnectGuard.wasCancelled()) return;
      await finalizeAiHold(billing);
      if (disconnectGuard.wasCancelled()) return;
      return res.json(result);
    } catch (error: any) {
      if (disconnectGuard.wasCancelled()) return;
      await releaseAiHold(billing, error?.message || "Performance prediction failed.");
      const failure = buildAiErrorResponse(error, "Performance prediction failed.");
      return res.status(failure.status).json({ error: failure.error });
    } finally {
      disconnectGuard.cleanup();
    }
  });

  app.post("/api/ai/enhance-photo", async (req, res) => {
    const { imageUrl, instruction, logoUrl, options, toolId = "one_tap_design_fix", tier, retryOfJobId } = req.body as {
      imageUrl?: string;
      instruction?: string;
      logoUrl?: string;
      options?: { imageSize?: "1K" | "2K"; promptEditRequest?: string };
      toolId?: string;
      tier?: UserTier;
      retryOfJobId?: string;
    };

    if (!imageUrl || !instruction) {
      return res.status(400).json({ error: "An image and instruction are required." });
    }

    const billing = await createAiHold(req, res, toolId, { tier, retryOfJobId });
    if (!billing) return;
    const disconnectGuard = attachAiDisconnectGuard(req, res, billing);

    try {
      await markAiJobProcessing(billing);
      const buffer = await enhancePhotoWithGemini(imageUrl, instruction, logoUrl, options);
      if (disconnectGuard.wasCancelled()) return;
      await finalizeAiHold(billing);
      if (disconnectGuard.wasCancelled()) return;
      res.setHeader("Content-Type", "image/png");
      return res.end(buffer);
    } catch (error: any) {
      if (disconnectGuard.wasCancelled()) return;
      await releaseAiHold(billing, error?.message || "Photo enhancement failed.");
      const failure = buildAiErrorResponse(error, "Photo enhancement failed.");
      return res.status(failure.status).json({ error: failure.error });
    } finally {
      disconnectGuard.cleanup();
    }
  });

  app.post("/api/ai/remove-object", async (req, res) => {
    const { imageUrl, maskUrl, instruction, toolId = "remove_clutter_photo", tier, retryOfJobId } = req.body as {
      imageUrl?: string;
      maskUrl?: string;
      instruction?: string;
      toolId?: string;
      tier?: UserTier;
      retryOfJobId?: string;
    };

    if (!imageUrl || !maskUrl || !instruction) {
      return res.status(400).json({ error: "Image, mask, and instruction are required." });
    }

    const billing = await createAiHold(req, res, toolId, { tier, retryOfJobId });
    if (!billing) return;
    const disconnectGuard = attachAiDisconnectGuard(req, res, billing);

    try {
      await markAiJobProcessing(billing);
      const buffer = await removeObjectWithGemini(imageUrl, maskUrl, instruction);
      if (disconnectGuard.wasCancelled()) return;
      await finalizeAiHold(billing);
      if (disconnectGuard.wasCancelled()) return;
      res.setHeader("Content-Type", "image/png");
      return res.end(buffer);
    } catch (error: any) {
      if (disconnectGuard.wasCancelled()) return;
      await releaseAiHold(billing, error?.message || "Object removal failed.");
      const failure = buildAiErrorResponse(error, "Object removal failed.");
      return res.status(failure.status).json({ error: failure.error });
    } finally {
      disconnectGuard.cleanup();
    }
  });

  app.post("/api/ai/pose-perfect", async (req, res) => {
    const { imageUrl, instruction, toolId = "pose_perfect", tier, retryOfJobId } = req.body as { imageUrl?: string; instruction?: string; toolId?: string; tier?: UserTier; retryOfJobId?: string };

    if (!imageUrl || !instruction) {
      return res.status(400).json({ error: "An image and instruction are required." });
    }

    const billing = await createAiHold(req, res, toolId, { tier, retryOfJobId });
    if (!billing) return;
    const disconnectGuard = attachAiDisconnectGuard(req, res, billing);

    try {
      await markAiJobProcessing(billing);
      const buffer = await posePerfectWithGemini(imageUrl, instruction);
      if (disconnectGuard.wasCancelled()) return;
      await finalizeAiHold(billing);
      if (disconnectGuard.wasCancelled()) return;
      res.setHeader("Content-Type", "image/png");
      return res.end(buffer);
    } catch (error: any) {
      if (disconnectGuard.wasCancelled()) return;
      await releaseAiHold(billing, error?.message || "Pose processing failed.");
      const failure = buildAiErrorResponse(error, "Pose processing failed.");
      return res.status(failure.status).json({ error: failure.error });
    } finally {
      disconnectGuard.cleanup();
    }
  });

  app.post("/api/ai/create-business-graphic", async (req, res) => {
    const input = req.body as Parameters<typeof createBusinessGraphicWithGemini>[0];
    const toolId = (req.body as any)?.toolId || "create";
    const tier = (req.body as any)?.tier as UserTier | undefined;
    const retryOfJobId = (req.body as any)?.retryOfJobId as string | undefined;

    if (!input?.useType) {
      return res.status(400).json({ error: "Graphic generation details are required." });
    }

    const billing = await createAiHold(req, res, toolId, { tier, retryOfJobId });
    if (!billing) return;
    const disconnectGuard = attachAiDisconnectGuard(req, res, billing);

    try {
      await markAiJobProcessing(billing);
      const buffer = await createBusinessGraphicWithGemini(input);
      if (disconnectGuard.wasCancelled()) return;
      await finalizeAiHold(billing);
      if (disconnectGuard.wasCancelled()) return;
      res.setHeader("Content-Type", "image/png");
      return res.end(buffer);
    } catch (error: any) {
      if (disconnectGuard.wasCancelled()) return;
      await releaseAiHold(billing, error?.message || "Graphic generation failed.");
      const failure = buildAiErrorResponse(error, "Graphic generation failed.");
      return res.status(failure.status).json({ error: failure.error });
    } finally {
      disconnectGuard.cleanup();
    }
  });

  app.post("/api/ai/plan-business-graphic-design", async (req, res) => {
    const input = req.body as Parameters<typeof planBusinessGraphicDesignWithGemini>[0];
    const toolId = (req.body as any)?.toolId || "create";
    const tier = (req.body as any)?.tier as UserTier | undefined;
    const retryOfJobId = (req.body as any)?.retryOfJobId as string | undefined;

    if (!input?.useType) {
      return res.status(400).json({ error: "Graphic planning details are required." });
    }

    const billing = await createAiHold(req, res, toolId, { tier, retryOfJobId });
    if (!billing) return;
    const disconnectGuard = attachAiDisconnectGuard(req, res, billing);

    try {
      await markAiJobProcessing(billing);
      const plan = await planBusinessGraphicDesignWithGemini(input);
      if (disconnectGuard.wasCancelled()) return;
      await finalizeAiHold(billing);
      if (disconnectGuard.wasCancelled()) return;
      return res.json(plan);
    } catch (error: any) {
      if (disconnectGuard.wasCancelled()) return;
      await releaseAiHold(billing, error?.message || "Graphic planning failed.");
      const failure = buildAiErrorResponse(error, "Graphic planning failed.");
      return res.status(failure.status).json({ error: failure.error });
    } finally {
      disconnectGuard.cleanup();
    }
  });

  app.post("/api/ai/create-business-graphic-document", async (req, res) => {
    const input = req.body as Parameters<typeof planBusinessGraphicDesignWithGemini>[0];
    const toolId = (req.body as any)?.toolId || "create";
    const tier = (req.body as any)?.tier as UserTier | undefined;
    const retryOfJobId = (req.body as any)?.retryOfJobId as string | undefined;

    if (!input?.useType) {
      return res.status(400).json({ error: "Graphic generation details are required." });
    }

    const billing = await createAiHold(req, res, toolId, { tier, retryOfJobId });
    if (!billing) return;
    const disconnectGuard = attachAiDisconnectGuard(req, res, billing);

    try {
      await markAiJobProcessing(billing);
      const plan = await planBusinessGraphicDesignWithGemini(input);
      if (disconnectGuard.wasCancelled()) return;
      const buffer = await renderBusinessGraphicDesignPlanWithGemini(input, plan);
      if (disconnectGuard.wasCancelled()) return;
      await finalizeAiHold(billing);
      if (disconnectGuard.wasCancelled()) return;
      return res.json({
        plan,
        previewImageUrl: `data:image/png;base64,${buffer.toString("base64")}`,
      });
    } catch (error: any) {
      if (disconnectGuard.wasCancelled()) return;
      await releaseAiHold(billing, error?.message || "Graphic generation failed.");
      const failure = buildAiErrorResponse(error, "Graphic generation failed.");
      return res.status(failure.status).json({ error: failure.error });
    } finally {
      disconnectGuard.cleanup();
    }
  });

  app.post("/api/ai/generate-video", async (req, res) => {
    const { imageUrl, prompt, toolId = "animate", tier, retryOfJobId } = req.body as { imageUrl?: string; prompt?: string; toolId?: string; tier?: UserTier; retryOfJobId?: string };

    if (!imageUrl || !prompt) {
      return res.status(400).json({ error: "An image and prompt are required." });
    }

    const billing = await createAiHold(req, res, toolId, { tier, retryOfJobId });
    if (!billing) return;
    const disconnectGuard = attachAiDisconnectGuard(req, res, billing);

    try {
      await markAiJobProcessing(billing);
      const result = await generateVideoWithGemini(imageUrl, prompt);
      if (disconnectGuard.wasCancelled()) return;
      await finalizeAiHold(billing);
      if (disconnectGuard.wasCancelled()) return;
      res.setHeader("Content-Type", result.mimeType || "video/mp4");
      return res.end(result.buffer);
    } catch (error: any) {
      if (disconnectGuard.wasCancelled()) return;
      await releaseAiHold(billing, error?.message || "Video generation failed.");
      const failure = buildAiErrorResponse(error, "Video generation failed.");
      return res.status(failure.status).json({ error: failure.error });
    } finally {
      disconnectGuard.cleanup();
    }
  });

  app.post("/api/ai/settle-local-fallback", async (req, res) => {
    const { toolId = "animate", tier, retryOfJobId } = req.body as {
      toolId?: string;
      tier?: UserTier;
      retryOfJobId?: string;
    };

    const billing = await createAiHold(req, res, toolId, { tier, retryOfJobId });
    if (!billing) return;

    try {
      await markAiJobProcessing(billing);
      await finalizeAiHold(billing);
      return res.json({ ok: true });
    } catch (error: any) {
      await releaseAiHold(billing, error?.message || "Local fallback billing settlement failed.");
      const failure = buildAiErrorResponse(error, "Local fallback billing settlement failed.");
      return res.status(failure.status).json({ error: failure.error });
    }
  });
  app.post("/api/help-request", async (req, res) => {
    const { subject, message, fromName, fromEmail } = req.body as {
      subject?: string;
      message?: string;
      fromName?: string;
      fromEmail?: string;
    };

    const cleanSubject = (subject || "CHROMANCY Help Request").trim().slice(0, 160);
    const cleanMessage = (message || "").trim();
    const cleanFromName = (fromName || "CHROMANCY user").trim().slice(0, 120);
    const cleanFromEmail = (fromEmail || "").trim().slice(0, 200);

    if (!cleanMessage) {
      return res.status(400).json({ error: "Please enter your help request before sending." });
    }

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      return res.status(503).json({ error: "Help email is not configured on the server yet. Add the support SMTP settings to enable in-app help sending." });
    }

    try {
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
      });

      const replyTo = cleanFromEmail || undefined;
      const body = [
        `From name: ${cleanFromName}`,
        `From email: ${cleanFromEmail || "Not provided"}`,
        `Sent at: ${new Date().toISOString()}`,
        "",
        cleanMessage,
      ].join("\n");

      await transporter.sendMail({
        from: SMTP_FROM,
        to: SUPPORT_INBOX,
        subject: `[CHROMANCY Help] ${cleanSubject}`,
        text: body,
        replyTo,
      });

      res.json({ ok: true });
    } catch (error) {
      console.error("Help request email failed", error);
      res.status(500).json({ error: "The app could not send the help request email." });
    }
  });


  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath, {
      setHeaders(res, filePath) {
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-store");
        }
      },
    }));
    app.get("*", (_req, res) => {
      applyNoStore(res);
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
