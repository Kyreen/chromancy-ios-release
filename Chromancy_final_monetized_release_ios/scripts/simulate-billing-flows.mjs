import { setTimeout as delay } from "node:timers/promises";

const baseUrl = process.env.CHROMANCY_SIM_BASE_URL || "http://127.0.0.1:3000";
const uid = process.env.CHROMANCY_SIM_UID || "sim-user-001";
const deviceId = process.env.CHROMANCY_SIM_DEVICE_ID || "sim-device-001";
const webhookSecret = process.env.REVENUECAT_WEBHOOK_SECRET || "change-this-revenuecat-webhook-secret";
const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAusB9Y9brN8AAAAASUVORK5CYII=";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(path, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  return { ok: response.ok, status: response.status, data };
}

async function sendWebhook(event) {
  const result = await requestJson("/api/billing/revenuecat-webhook", { api_version: "1.0", event }, {
    Authorization: `Bearer ${webhookSecret}`,
  });

  assert(result.ok, `Webhook failed for ${event.type}: ${JSON.stringify(result.data)}`);
  console.log(`Webhook ${event.type} accepted.`);
  return result.data;
}

async function fetchSnapshot(label) {
  const result = await requestJson("/api/usage/snapshot", {
    uid,
    deviceId,
    tier: "free",
  });
  assert(result.ok, `Snapshot failed: ${JSON.stringify(result.data)}`);

  const snapshot = result.data;
  const summary = {
    tier: snapshot.tier,
    walletBalanceCents: snapshot.wallet?.balanceCents || 0,
    walletDebtCents: snapshot.wallet?.debtCents || 0,
    subscriptionCredits: snapshot.wallet?.proCreditsRemaining || 0,
    subscriptionPlan: snapshot.wallet?.subscription?.planId || null,
    subscriptionStatus: snapshot.wallet?.subscription?.status || null,
    subscriptionActive: snapshot.wallet?.subscription?.isActive || false,
  };
  console.log(`${label}:`, JSON.stringify(summary, null, 2));
  return snapshot;
}

async function expectFailedAi(toolId, tier) {
  const result = await requestJson("/api/ai/enhance-photo", {
    uid,
    deviceId,
    spendConfirmed: true,
    toolId,
    tier,
    imageUrl: tinyPng,
    instruction: "Simulation request",
  });

  assert(!result.ok, "Expected AI request to fail without a live Gemini key.");
  assert(result.status === 503 || result.status === 500 || result.status === 422, `Unexpected AI failure status: ${result.status}`);
  console.log(`AI request for ${toolId} failed as expected with status ${result.status}.`);
}

async function main() {
  console.log(`Using ${baseUrl} for billing simulation as ${uid}.`);
  await fetchSnapshot("Initial snapshot");

  const now = Date.now();
  const monthMs = 30 * 24 * 60 * 60 * 1000;

  await sendWebhook({
    id: "sim-wallet-100-purchase",
    type: "NON_RENEWING_PURCHASE",
    app_user_id: uid,
    product_id: "chromancy_wallet_100",
    transaction_id: "sim-wallet-100-tx",
    event_timestamp_ms: now,
  });

  let snapshot = await fetchSnapshot("After wallet top-up");
  assert(snapshot.wallet?.balanceCents === 10000, "Wallet top-up was not credited.");

  const walletBeforeFailedAi = snapshot.wallet.balanceCents;
  await expectFailedAi("smooth_skin", "free");
  snapshot = await fetchSnapshot("After failed wallet AI request");
  assert(snapshot.wallet?.balanceCents === walletBeforeFailedAi, "Failed wallet AI request should not consume wallet balance.");

  await sendWebhook({
    id: "sim-pro-initial",
    type: "INITIAL_PURCHASE",
    app_user_id: uid,
    product_id: "chromancy_pro:monthly",
    transaction_id: "sim-pro-tx-1",
    original_transaction_id: "sim-pro-original",
    purchased_at_ms: now,
    expiration_at_ms: now + monthMs,
    event_timestamp_ms: now,
  });

  snapshot = await fetchSnapshot("After Pro activation");
  assert(snapshot.wallet?.subscription?.planId === "pro", "Pro subscription was not activated.");
  assert(snapshot.wallet?.subscription?.isActive === true, "Pro subscription is not active.");
  assert(snapshot.wallet?.proCreditsRemaining === 40, "Pro subscription credits were not granted.");

  const creditsBeforeFailedAi = snapshot.wallet.proCreditsRemaining;
  await expectFailedAi("smooth_skin", "pro");
  snapshot = await fetchSnapshot("After failed Pro AI request");
  assert(snapshot.wallet?.proCreditsRemaining === creditsBeforeFailedAi, "Failed subscribed AI request should not consume credits.");

  await sendWebhook({
    id: "sim-pro-renewal",
    type: "RENEWAL",
    app_user_id: uid,
    product_id: "chromancy_pro:monthly",
    transaction_id: "sim-pro-tx-2",
    original_transaction_id: "sim-pro-original",
    purchased_at_ms: now + monthMs,
    expiration_at_ms: now + monthMs * 2,
    event_timestamp_ms: now + monthMs,
  });

  snapshot = await fetchSnapshot("After Pro renewal");
  assert(snapshot.wallet?.proCreditsRemaining === 40, "Renewal did not reset credits on the new billing cycle.");

  await sendWebhook({
    id: "sim-premium-upgrade",
    type: "PRODUCT_CHANGE",
    app_user_id: uid,
    product_id: "chromancy_premium:monthly",
    transaction_id: "sim-premium-tx-1",
    original_transaction_id: "sim-pro-original",
    purchased_at_ms: now + monthMs * 2,
    expiration_at_ms: now + monthMs * 3,
    event_timestamp_ms: now + monthMs * 2,
  });

  snapshot = await fetchSnapshot("After Premium upgrade");
  assert(snapshot.wallet?.subscription?.planId === "premium", "Premium upgrade was not applied.");
  assert(snapshot.wallet?.proCreditsRemaining === 60, "Premium cycle should grant 60 AI credits.");

  await sendWebhook({
    id: "sim-premium-billing-issue",
    type: "BILLING_ISSUE",
    app_user_id: uid,
    product_id: "chromancy_premium:monthly",
    transaction_id: "sim-premium-tx-1",
    original_transaction_id: "sim-pro-original",
    purchased_at_ms: now + monthMs * 2,
    expiration_at_ms: now + monthMs * 3,
    grace_period_expiration_at_ms: now + monthMs * 3 + 7 * 24 * 60 * 60 * 1000,
    event_timestamp_ms: now + monthMs * 3,
  });

  snapshot = await fetchSnapshot("After billing issue");
  assert(snapshot.wallet?.subscription?.status === "billing_issue", "Billing issue state was not recorded.");
  assert(snapshot.wallet?.subscription?.isActive === true, "Billing issue should keep the subscription active through grace period.");

  await sendWebhook({
    id: "sim-wallet-100-refund",
    type: "CANCELLATION",
    app_user_id: uid,
    product_id: "chromancy_wallet_100",
    transaction_id: "sim-wallet-100-tx",
    event_timestamp_ms: now + 12345,
  });

  snapshot = await fetchSnapshot("After wallet refund");
  assert(snapshot.wallet?.balanceCents === 0, "Wallet refund should reverse the credited balance.");

  await sendWebhook({
    id: "sim-premium-expiration",
    type: "EXPIRATION",
    app_user_id: uid,
    product_id: "chromancy_premium:monthly",
    transaction_id: "sim-premium-tx-1",
    original_transaction_id: "sim-pro-original",
    expiration_at_ms: now - 1000,
    event_timestamp_ms: now + monthMs * 4,
    expiration_reason: "BILLING_ERROR",
  });

  snapshot = await fetchSnapshot("After expiration");
  assert(snapshot.wallet?.subscription?.isActive === false, "Expired subscription should no longer be active.");
  assert(snapshot.wallet?.proCreditsRemaining === 0, "Expired subscription should not keep credits.");

  console.log("Billing flow simulation passed.");
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await delay(10);
  process.exitCode = 1;
});
