import crypto from "crypto";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { exec, execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const FIREBASE_CONFIG_PATH = path.join(PROJECT_ROOT, "firebase-applet-config.json");

const REVIEW_EMAIL = (process.env.CHROMANCY_REVIEW_EMAIL || "playreview@chromancy.online").trim().toLowerCase();
const REVIEW_PASSWORD = process.env.CHROMANCY_REVIEW_PASSWORD || "ChromancyReview#2026!";
const REVIEW_DISPLAY_NAME = (process.env.CHROMANCY_REVIEW_DISPLAY_NAME || "Google Play Review").trim();
const REVIEW_WALLET_CENTS = Math.max(0, Number(process.env.CHROMANCY_REVIEW_WALLET_CENTS || 50000) || 50000);
const REVIEW_PRO_CREDITS = Math.max(1, Number(process.env.CHROMANCY_REVIEW_PRO_CREDITS || 60) || 60);
const REVIEW_SUBSCRIPTION_DAYS = Math.max(30, Number(process.env.CHROMANCY_REVIEW_SUBSCRIPTION_DAYS || 90) || 90);
const REVIEW_DEVICE_ID = "play-review-device";
const REVIEW_ORIGINAL_TRANSACTION_ID = "chromancy_play_review_seed";
const REVIEW_PLAN_ID = "premium";
const REVIEW_PRODUCT_ID = "chromancy_premium:monthly";
const REVIEW_MONTHLY_AI_CREDITS = 60;
const USAGE_STORE_COLLECTION = process.env.CHROMANCY_USAGE_STORE_COLLECTION || "server_private";
const USAGE_STORE_DOC_ID = process.env.CHROMANCY_USAGE_STORE_DOC_ID || "billing_usage_store";
const API_BASE_URL = (process.env.CHROMANCY_API_BASE_URL || "https://api.chromancy.online").replace(/\/+$/, "");

function getGcloudCommand() {
  if (process.env.GCLOUD_BIN?.trim()) return process.env.GCLOUD_BIN.trim();
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    const bundledPath = path.join(localAppData, "Google", "Cloud SDK", "google-cloud-sdk", "bin", "gcloud.cmd");
    if (localAppData && existsSync(bundledPath)) return bundledPath;
    return "gcloud.cmd";
  }
  return "gcloud";
}

function nowIso() {
  return new Date().toISOString();
}

function currentMonthKey() {
  return nowIso().slice(0, 7);
}

function plusDaysIso(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function hashValue(value, salt) {
  return crypto.createHash("sha256").update(`${salt}:${value}`).digest("hex");
}

function getAccountKey(uid, salt) {
  return `acct:${hashValue(uid, salt)}`;
}

function emptyCategoryCounts() {
  return { photo: 0, video: 0, design: 0, business: 0 };
}

function emptyToolTrials() {
  return {
    manual_edit: 0,
    one_tap_fix: 0,
    fix_lighting: 0,
    sharpen: 0,
    hd_upgrade: 0,
    extend_photo: 0,
    change_background: 0,
    change_vibe: 0,
    pose_perfect: 0,
    smooth_skin: 0,
    remove_clutter_photo: 0,
    blur_background: 0,
    pro_headshot: 0,
    face_focus_enhancer: 0,
    animate: 0,
    video_manual_edit: 0,
    video_fix_lighting: 0,
    one_tap_video_fix: 0,
    beam_mode: 0,
    pro_look: 0,
    design_critic: 0,
    one_tap_design_fix: 0,
    design_brand_image: 0,
    make_it_pop: 0,
    clean_up: 0,
    fix_type: 0,
    mockup_generator: 0,
    food_enhancer: 0,
    studio_shot: 0,
    business_brand_image: 0,
    create: 0,
    smart_performance_predictor: 0,
  };
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) {
    return Array.isArray(value.arrayValue?.values) ? value.arrayValue.values.map(decodeFirestoreValue) : [];
  }
  if ("mapValue" in value) {
    const fields = value.mapValue?.fields || {};
    return Object.fromEntries(Object.entries(fields).map(([key, nextValue]) => [key, decodeFirestoreValue(nextValue)]));
  }
  return null;
}

function encodeFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  }
  if (typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value)
            .filter(([, nextValue]) => nextValue !== undefined)
            .map(([key, nextValue]) => [key, encodeFirestoreValue(nextValue)]),
        ),
      },
    };
  }
  throw new Error(`Unsupported Firestore value: ${typeof value}`);
}

function encodeFirestoreFields(value) {
  const encoded = encodeFirestoreValue(value);
  return encoded.mapValue?.fields || {};
}

function decodeFirestoreDocument(document) {
  const fields = document?.fields || {};
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]));
}

async function requestJson(url, { method = "GET", headers, body } = {}) {
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || payload?.error || payload?.message || `${method} ${url} failed with ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

async function getGcloudAccessToken() {
  const { stdout } = await runGcloud(["auth", "print-access-token"]);
  return stdout.trim();
}

async function readFirebaseConfig() {
  const raw = await fs.readFile(FIREBASE_CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

async function getSecretValue(secretName) {
  const { stdout } = await runGcloud(["secrets", "versions", "access", "latest", `--secret=${secretName}`]);
  return stdout.trim();
}

async function runGcloud(args) {
  const command = getGcloudCommand();
  if (process.platform !== "win32") {
    return await execFileAsync(command, args, { windowsHide: true });
  }

  const quotedCommand = `"${command.replace(/"/g, '""')}" ${args.map((arg) => `"${String(arg).replace(/"/g, '""')}"`).join(" ")}`;
  return await execAsync(quotedCommand, {
    windowsHide: true,
    shell: process.env.ComSpec || "cmd.exe",
  });
}

async function createOrSignInReviewUser(apiKey) {
  try {
    const created = await requestJson(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: {
        email: REVIEW_EMAIL,
        password: REVIEW_PASSWORD,
        returnSecureToken: true,
      },
    });
    return { ...created, created: true };
  } catch (error) {
    const message = String(error?.message || error);
    if (!message.includes("EMAIL_EXISTS")) {
      throw error;
    }

    const signedIn = await requestJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: {
        email: REVIEW_EMAIL,
        password: REVIEW_PASSWORD,
        returnSecureToken: true,
      },
    });
    return { ...signedIn, created: false };
  }
}

async function fetchFirestoreDocument(projectId, documentPath, accessToken) {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${documentPath}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 404) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Failed to fetch Firestore document ${documentPath}`;
    throw new Error(message);
  }
  return payload;
}

async function upsertFirestoreDocument(projectId, documentPath, accessToken, fields) {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${documentPath}`;
  return await requestJson(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: {
      fields: encodeFirestoreFields(fields),
    },
  });
}

function buildReviewTransactions(existingTransactions) {
  const retained = Array.isArray(existingTransactions)
    ? existingTransactions.filter((transaction) => !String(transaction?.id || "").startsWith("review_seed_"))
    : [];

  retained.push({
    id: "review_seed_wallet_topup",
    createdAt: nowIso(),
    type: "top-up",
    amountCents: REVIEW_WALLET_CENTS,
    productId: "play_review_wallet_seed",
    note: "Seeded wallet balance for Google Play reviewer account.",
  });

  retained.push({
    id: "review_seed_subscription_sync",
    createdAt: nowIso(),
    type: "top-up",
    amountCents: 0,
    productId: REVIEW_PRODUCT_ID,
    note: "Seeded Premium review access and AI credits for Google Play review.",
  });

  return retained.slice(-250);
}

function buildReviewAccount(existingAccount = {}) {
  const cycleStartedAt = nowIso();
  const cycleEndsAt = plusDaysIso(REVIEW_SUBSCRIPTION_DAYS);
  const subscriptionCycleId = [REVIEW_PRODUCT_ID, cycleStartedAt, cycleEndsAt, REVIEW_ORIGINAL_TRANSACTION_ID].join("|");
  return {
    credits: { ...emptyCategoryCounts(), ...(existingAccount.credits || {}) },
    premiumUsage: emptyCategoryCounts(),
    premiumUsageMonth: currentMonthKey(),
    freeTrials: { ...emptyCategoryCounts(), ...(existingAccount.freeTrials || {}) },
    walletCents: REVIEW_WALLET_CENTS,
    proCredits: REVIEW_PRO_CREDITS,
    proCreditsMonth: currentMonthKey(),
    proEntitlementActive: true,
    proMonthlyCreditAllowance: REVIEW_MONTHLY_AI_CREDITS,
    activeSubscriptionPlanId: REVIEW_PLAN_ID,
    activeSubscriptionProductId: REVIEW_PRODUCT_ID,
    subscriptionStatus: "active",
    subscriptionCycleId,
    subscriptionCycleStartedAt: cycleStartedAt,
    subscriptionCycleEndsAt: cycleEndsAt,
    subscriptionOriginalTransactionId: REVIEW_ORIGINAL_TRANSACTION_ID,
    lastSubscriptionPurchaseAt: cycleStartedAt,
    billingIssueDetectedAt: null,
    gracePeriodEndsAt: null,
    toolFreeTrials: { ...emptyToolTrials(), ...(existingAccount.toolFreeTrials || {}) },
    transactions: buildReviewTransactions(existingAccount.transactions),
    holds: existingAccount.holds || {},
    jobs: existingAccount.jobs || {},
    processedPurchases: existingAccount.processedPurchases || {},
    processedWebhookEvents: existingAccount.processedWebhookEvents || {},
    reversedPurchases: existingAccount.reversedPurchases || {},
  };
}

function buildUserProfile(existingUser = {}) {
  return {
    ...existingUser,
    email: REVIEW_EMAIL,
    displayName: REVIEW_DISPLAY_NAME,
    tier: "premium",
    createdAt: typeof existingUser.createdAt === "string" && existingUser.createdAt.trim() ? existingUser.createdAt : nowIso(),
  };
}

async function fetchUsageSnapshot(idToken) {
  return await requestJson(`${API_BASE_URL}/api/usage/snapshot`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: {
      uid: null,
      deviceId: REVIEW_DEVICE_ID,
      tier: "premium",
    },
  });
}

async function fetchTransactions(idToken) {
  return await requestJson(`${API_BASE_URL}/api/billing/transactions`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Cache-Control": "no-store",
    },
  });
}

async function main() {
  const firebaseConfig = await readFirebaseConfig();
  const apiKey = String(firebaseConfig.apiKey || "").trim();
  const projectId = String(firebaseConfig.projectId || "").trim();

  if (!apiKey || !projectId) {
    throw new Error("firebase-applet-config.json is missing apiKey or projectId.");
  }

  const [accessToken, hashSalt] = await Promise.all([
    getGcloudAccessToken(),
    getSecretValue("CHROMANCY_USAGE_SALT"),
  ]);

  const authSession = await createOrSignInReviewUser(apiKey);
  const uid = String(authSession.localId || "").trim();
  const idToken = String(authSession.idToken || "").trim();

  if (!uid || !idToken) {
    throw new Error("Could not create or sign in the review account.");
  }

  await requestJson(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: {
      idToken,
      displayName: REVIEW_DISPLAY_NAME,
      returnSecureToken: true,
    },
  });

  const storePath = `${USAGE_STORE_COLLECTION}/${USAGE_STORE_DOC_ID}`;
  const userDocPath = `users/${uid}`;

  const [storeDocument, userDocument] = await Promise.all([
    fetchFirestoreDocument(projectId, storePath, accessToken),
    fetchFirestoreDocument(projectId, userDocPath, accessToken),
  ]);

  const store = storeDocument ? decodeFirestoreDocument(storeDocument) : {
    accounts: {},
    devices: {},
    ipTrials: {},
    ipToolTrials: {},
  };
  store.accounts = store.accounts && typeof store.accounts === "object" ? store.accounts : {};
  store.devices = store.devices && typeof store.devices === "object" ? store.devices : {};
  store.ipTrials = store.ipTrials && typeof store.ipTrials === "object" ? store.ipTrials : {};
  store.ipToolTrials = store.ipToolTrials && typeof store.ipToolTrials === "object" ? store.ipToolTrials : {};

  const accountKey = getAccountKey(uid, hashSalt);
  store.accounts[accountKey] = buildReviewAccount(store.accounts[accountKey]);

  const existingUser = userDocument ? decodeFirestoreDocument(userDocument) : {};
  const nextUser = buildUserProfile(existingUser);

  await Promise.all([
    upsertFirestoreDocument(projectId, storePath, accessToken, store),
    upsertFirestoreDocument(projectId, userDocPath, accessToken, nextUser),
  ]);

  const [snapshot, transactions] = await Promise.all([
    fetchUsageSnapshot(idToken),
    fetchTransactions(idToken),
  ]);

  const result = {
    email: REVIEW_EMAIL,
    password: REVIEW_PASSWORD,
    uid,
    created: Boolean(authSession.created),
    walletBalanceCents: snapshot?.wallet?.balanceCents ?? null,
    proCreditsRemaining: snapshot?.wallet?.proCreditsRemaining ?? null,
    subscription: snapshot?.wallet?.subscription || null,
    transactionCount: Array.isArray(transactions?.transactions) ? transactions.transactions.length : 0,
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
