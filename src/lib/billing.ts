import { Capacitor } from "@capacitor/core";
import { UserTier } from "../types";
import { Purchases, PRODUCT_CATEGORY, type CustomerInfo, type PurchasesEntitlementInfo } from "@revenuecat/purchases-capacitor";
import { PRO_SUBSCRIPTION, SUBSCRIPTION_PLANS, WALLET_TOP_UPS, getSubscriptionPlan } from "./toolConfig";
import { syncBillingCustomerInfo, type UsageSnapshot } from "./serverUsage";
import { auth } from "./firebase";

const PRO_ENTITLEMENT = import.meta.env.VITE_RC_PRO_ENTITLEMENT || PRO_SUBSCRIPTION.entitlement;
const PLAY_PRO_PRODUCT_ID = import.meta.env.VITE_PLAY_PRO_PRODUCT_ID || PRO_SUBSCRIPTION.revenueCatIdentifier;
const PLAY_PREMIUM_PRODUCT_ID = import.meta.env.VITE_PLAY_PREMIUM_PRODUCT_ID || SUBSCRIPTION_PLANS[1].revenueCatIdentifier;
const APPLE_PRO_PRODUCT_ID = import.meta.env.VITE_APPLE_PRO_PRODUCT_ID || PRO_SUBSCRIPTION.productId;
const APPLE_PREMIUM_PRODUCT_ID = import.meta.env.VITE_APPLE_PREMIUM_PRODUCT_ID || SUBSCRIPTION_PLANS[1].productId;
const REVENUECAT_PUBLIC_ANDROID_KEY = import.meta.env.VITE_REVENUECAT_PUBLIC_ANDROID_KEY || "goog_GkUKxtCgSvcETONOPviDMeJtMWw";
const REVENUECAT_PUBLIC_IOS_KEY = import.meta.env.VITE_REVENUECAT_PUBLIC_IOS_KEY || "";

interface RevenueCatOfferings {
  current?: {
    availablePackages?: Array<{
      identifier: string;
      product: {
        identifier: string;
      };
      packageType?: string;
    }>;
  };
}

type SubscriptionPlan = typeof SUBSCRIPTION_PLANS[number];
type CustomerInfoSyncReason = "subscription_purchase" | "wallet_top_up" | "restore";

interface BillingSyncResult {
  customerInfo?: CustomerInfo;
  snapshot?: UsageSnapshot;
}

function subscriptionProductMatches(candidate: string | null | undefined, plan: SubscriptionPlan) {
  if (!candidate) return false;
  const normalized = candidate.toLowerCase();
  const expected = [
    plan.productId,
    plan.revenueCatIdentifier,
    `${plan.productId}:${plan.basePlanId}`,
    plan.planId,
    `${plan.planId}_monthly`,
  ].map((value) => value.toLowerCase());
  return expected.includes(normalized) || normalized.includes(plan.productId.toLowerCase()) || normalized.includes(plan.revenueCatIdentifier.toLowerCase());
}

declare global {
  interface Window {
    Purchases?: any;
  }
}

let configuredRevenueCatUserId: string | null = null;

function serializeCustomerInfoForServer(customerInfo?: CustomerInfo | null, reason?: CustomerInfoSyncReason) {
  const activeEntitlements = customerInfo?.entitlements?.active || {};
  return {
    reason,
    appUserId: customerInfo?.originalAppUserId || configuredRevenueCatUserId || null,
    originalAppUserId: customerInfo?.originalAppUserId || null,
    activeSubscriptions: customerInfo?.activeSubscriptions || [],
    allPurchasedProductIdentifiers: customerInfo?.allPurchasedProductIdentifiers || [],
    allPurchaseDates: customerInfo?.allPurchaseDates || {},
    allExpirationDates: customerInfo?.allExpirationDates || {},
    entitlements: Object.fromEntries(
      Object.entries(activeEntitlements).map(([key, entitlement]) => {
        const info = entitlement as any;
        return [
          key,
          {
            productIdentifier: info?.productIdentifier || null,
            productPlanIdentifier: info?.productPlanIdentifier || null,
            latestPurchaseDate: info?.latestPurchaseDate || null,
            originalPurchaseDate: info?.originalPurchaseDate || null,
            expirationDate: info?.expirationDate || null,
            isActive: info?.isActive ?? null,
          },
        ];
      }),
    ),
    nonSubscriptionTransactions: (customerInfo as any)?.nonSubscriptionTransactions || [],
    requestDate: (customerInfo as any)?.requestDate || new Date().toISOString(),
  };
}

async function syncRevenueCatCustomerInfo(customerInfo?: CustomerInfo | null, reason?: CustomerInfoSyncReason): Promise<UsageSnapshot | undefined> {
  if (!customerInfo) return undefined;
  return syncBillingCustomerInfo(serializeCustomerInfoForServer(customerInfo, reason)).catch((error) => {
    console.warn("RevenueCat customer info sync failed", error);
    return undefined;
  });
}

function getPlatformSubscriptionProductId(planId: string) {
  if (Capacitor.getPlatform() === "ios") {
    return planId === "premium" ? APPLE_PREMIUM_PRODUCT_ID : APPLE_PRO_PRODUCT_ID;
  }
  return planId === "premium" ? PLAY_PREMIUM_PRODUCT_ID : PLAY_PRO_PRODUCT_ID;
}

function getPurchasesPlugin(): any | null {
  const plugin = Purchases || (window as any)?.Capacitor?.Plugins?.Purchases || window.Purchases || null;
  return plugin ?? null;
}

export function isNativeBillingAvailable() {
  return Capacitor.isNativePlatform() && !!getPurchasesPlugin();
}

let lastSyncedRevenueCatEmail: string | null = null;

async function syncRevenueCatIdentity(plugin: any) {
  // Attach the signed-in email/name to the RevenueCat customer so the dashboard
  // shows a readable identity instead of only the Firebase UID. Attributes are
  // cosmetic — never let a failure here block billing.
  try {
    const user = auth.currentUser;
    if (!user?.email || user.email === lastSyncedRevenueCatEmail) return;
    if (plugin.setEmail) {
      await plugin.setEmail({ email: user.email });
    }
    if (user.displayName && plugin.setDisplayName) {
      await plugin.setDisplayName({ displayName: user.displayName });
    }
    lastSyncedRevenueCatEmail = user.email;
  } catch (error) {
    console.warn("RevenueCat identity attributes could not be set.", error);
  }
}

export async function initBilling(appUserID?: string | null) {
  const plugin = getPurchasesPlugin();
  if (!plugin) return false;

  const apiKey = Capacitor.getPlatform() === "ios" ? REVENUECAT_PUBLIC_IOS_KEY : REVENUECAT_PUBLIC_ANDROID_KEY;
  if (!apiKey) {
    const platform = Capacitor.getPlatform();
    console.warn(
      `[Chromancy] RevenueCat public SDK key missing for platform "${platform}". ` +
      `Wallet and subscription features are disabled. ` +
      `Set VITE_REVENUECAT_PUBLIC_IOS_KEY in .env.production and rebuild.`
    );
    return false;
  }

  if ((window as any).__chromancyBillingReady) {
    if (appUserID && configuredRevenueCatUserId !== appUserID && plugin.logIn) {
      await plugin.logIn({ appUserID });
      configuredRevenueCatUserId = appUserID;
      lastSyncedRevenueCatEmail = null;
    }
    await syncRevenueCatIdentity(plugin);
    return true;
  }

  await plugin.configure({
    apiKey,
    appUserID: appUserID || undefined,
  });

  (window as any).__chromancyBillingReady = true;
  configuredRevenueCatUserId = appUserID || null;
  await syncRevenueCatIdentity(plugin);
  return true;
}

export async function purchaseSubscription(planId: string, appUserID?: string | null) {
  const plugin = getPurchasesPlugin();
  if (!plugin) {
    throw new Error("Billing is not ready on this build yet. Finish your store product setup and try again on the native app build.");
  }

  const billingReady = await initBilling(appUserID);
  if (!billingReady) {
    throw new Error("Billing is not configured for this platform yet. Check the RevenueCat public SDK key and native store setup.");
  }
  const plan = SUBSCRIPTION_PLANS.find((item) => item.planId === planId) || PRO_SUBSCRIPTION;
  const configuredProductId = getPlatformSubscriptionProductId(plan.planId);
  const offerings = (await plugin.getOfferings()) as RevenueCatOfferings;
  const targetPackage = offerings?.current?.availablePackages?.find((pkg) =>
    subscriptionProductMatches(pkg.product?.identifier, plan) ||
    subscriptionProductMatches(pkg.identifier, plan) ||
    pkg.product?.identifier === configuredProductId
  );

  if (!targetPackage) {
    throw new Error(`${plan.displayName} subscription product not found: ${configuredProductId}`);
  }

  const result = await plugin.purchasePackage({ aPackage: targetPackage });
  await plugin.syncPurchases?.().catch(() => undefined);
  const customerInfo = result?.customerInfo as CustomerInfo | undefined;
  await syncRevenueCatCustomerInfo(customerInfo, "subscription_purchase");
  return customerInfo;
}

export async function purchaseProSubscription(appUserID?: string | null) {
  return purchaseSubscription(PRO_SUBSCRIPTION.planId, appUserID);
}

export async function purchaseWalletTopUp(productId: string, appUserID?: string | null) {
  const plugin = getPurchasesPlugin();
  if (!plugin) {
    throw new Error("Billing is not ready on this build yet. Finish your store product setup and try again on the native app build.");
  }

  const billingReady = await initBilling(appUserID);
  if (!billingReady) {
    throw new Error("Billing is not configured for this platform yet. Check the RevenueCat public SDK key and native store setup.");
  }
  const knownProduct = WALLET_TOP_UPS.some((topUp) => topUp.productId === productId);
  if (!knownProduct) {
    throw new Error(`Unknown wallet top-up product: ${productId}`);
  }

  await plugin.invalidateCustomerInfoCache?.().catch(() => undefined);
  const productResult = await plugin.getProducts({ productIdentifiers: [productId], type: PRODUCT_CATEGORY.NON_SUBSCRIPTION });
  const storeProduct = productResult?.products?.[0] || productResult?.[0];

  if (!storeProduct) {
    throw new Error(`Wallet top-up product not found: ${productId}`);
  }

  const result = await plugin.purchaseStoreProduct({ product: storeProduct });
  await plugin.syncPurchases?.().catch(() => undefined);
  await plugin.invalidateCustomerInfoCache?.().catch(() => undefined);
  const customerInfo = result?.customerInfo as CustomerInfo | undefined;
  const snapshot = await syncRevenueCatCustomerInfo(customerInfo, "wallet_top_up");
  return { ...result, customerInfo, snapshot } as typeof result & BillingSyncResult;
}

// Localized store prices for the wallet top-ups, keyed by product id (e.g. "$2.99",
// "R 54,99"). App Review requires the app to display the store's own localized price
// for each IAP, not a hardcoded amount. Returns {} off-native or if the store lookup
// fails, so callers can fall back to approximate labels.
export async function getWalletTopUpStorePrices(): Promise<Record<string, string>> {
  try {
    const plugin = getPurchasesPlugin();
    if (!plugin || !Capacitor.isNativePlatform()) return {};
    const billingReady = await initBilling(auth.currentUser?.uid || null);
    if (!billingReady) return {};

    const productIdentifiers = WALLET_TOP_UPS.map((topUp) => topUp.productId);
    const productResult = await plugin.getProducts({ productIdentifiers, type: PRODUCT_CATEGORY.NON_SUBSCRIPTION });
    const products: any[] = productResult?.products || (Array.isArray(productResult) ? productResult : []);

    const prices: Record<string, string> = {};
    for (const product of products) {
      const identifier = String(product?.identifier || product?.productIdentifier || "");
      const priceString = String(product?.priceString || product?.price_string || "").trim();
      if (identifier && priceString) prices[identifier] = priceString;
    }
    return prices;
  } catch (error) {
    console.warn("Could not load localized wallet prices from the store.", error);
    return {};
  }
}

export async function restoreBillingPurchases(appUserID?: string | null) {
  const plugin = getPurchasesPlugin();
  if (!plugin) {
    throw new Error("Billing restore is not ready on this build.");
  }

  const billingReady = await initBilling(appUserID);
  if (!billingReady) {
    throw new Error("Billing is not configured for this platform yet. Check the RevenueCat public SDK key and native store setup.");
  }
  const result = await plugin.restorePurchases();
  await plugin.syncPurchases?.().catch(() => undefined);
  const customerInfo = result?.customerInfo as CustomerInfo | undefined;
  await syncRevenueCatCustomerInfo(customerInfo, "restore");
  return customerInfo;
}

function getActiveEntitlement(customerInfo?: CustomerInfo | null): PurchasesEntitlementInfo | null {
  return customerInfo?.entitlements?.active?.[PRO_ENTITLEMENT] || null;
}

export function getSubscriptionPlanFromCustomerInfo(customerInfo?: CustomerInfo | null) {
  const activeEntitlement = getActiveEntitlement(customerInfo);
  const entitlementProductId = activeEntitlement?.productIdentifier
    ? activeEntitlement.productPlanIdentifier
      ? `${activeEntitlement.productIdentifier}:${activeEntitlement.productPlanIdentifier}`
      : activeEntitlement.productIdentifier
    : null;
  const candidates = [
    entitlementProductId,
    activeEntitlement?.productIdentifier || null,
    ...(customerInfo?.activeSubscriptions || []),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const plan = getSubscriptionPlan(candidate);
    if (plan) return plan;
  }

  return null;
}

export function getTierFromCustomerInfo(customerInfo?: CustomerInfo | null): UserTier {
  const plan = getSubscriptionPlanFromCustomerInfo(customerInfo);
  if (plan?.planId === "premium") return "premium";
  if (plan?.planId === "pro") return "pro";
  if (getActiveEntitlement(customerInfo)) return "pro";
  return "free";
}

export function getSubscriptionName(productId?: string | null) {
  return getSubscriptionPlan(productId)?.displayName || "Premium";
}
