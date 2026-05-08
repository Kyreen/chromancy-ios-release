import { Capacitor } from "@capacitor/core";
import { UserTier } from "../types";
import { Purchases, PRODUCT_CATEGORY, type CustomerInfo, type PurchasesEntitlementInfo } from "@revenuecat/purchases-capacitor";
import { PRO_SUBSCRIPTION, SUBSCRIPTION_PLANS, WALLET_TOP_UPS, getSubscriptionPlan } from "./toolConfig";

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

declare global {
  interface Window {
    Purchases?: any;
  }
}

let configuredRevenueCatUserId: string | null = null;

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

export async function initBilling(appUserID?: string | null) {
  const plugin = getPurchasesPlugin();
  if (!plugin) return false;

  const apiKey = Capacitor.getPlatform() === "ios" ? REVENUECAT_PUBLIC_IOS_KEY : REVENUECAT_PUBLIC_ANDROID_KEY;
  if (!apiKey) {
    console.warn("RevenueCat public SDK key missing; billing initialization skipped.");
    return false;
  }

  if ((window as any).__chromancyBillingReady) {
    if (appUserID && configuredRevenueCatUserId !== appUserID && plugin.logIn) {
      await plugin.logIn({ appUserID });
      configuredRevenueCatUserId = appUserID;
    }
    return true;
  }

  await plugin.configure({
    apiKey,
    appUserID: appUserID || undefined,
  });

  (window as any).__chromancyBillingReady = true;
  configuredRevenueCatUserId = appUserID || null;
  return true;
}

export async function purchaseSubscription(planId: string, appUserID?: string | null) {
  const plugin = getPurchasesPlugin();
  if (!plugin) {
    throw new Error("Billing is not ready on this build yet. Finish your store product setup and try again on the native app build.");
  }

  await initBilling(appUserID);
  const plan = SUBSCRIPTION_PLANS.find((item) => item.planId === planId) || PRO_SUBSCRIPTION;
  const configuredProductId = getPlatformSubscriptionProductId(plan.planId);
  const offerings = (await plugin.getOfferings()) as RevenueCatOfferings;
  const targetPackage = offerings?.current?.availablePackages?.find((pkg) =>
    pkg.product?.identifier === configuredProductId ||
    pkg.product?.identifier === plan.productId ||
    pkg.product?.identifier === plan.revenueCatIdentifier ||
    pkg.identifier === plan.planId ||
    pkg.identifier === `${plan.planId}_monthly`
  );

  if (!targetPackage) {
    throw new Error(`${plan.displayName} subscription product not found: ${configuredProductId}`);
  }

  const result = await plugin.purchasePackage({ aPackage: targetPackage });
  await plugin.syncPurchases?.().catch(() => undefined);
  return result?.customerInfo as CustomerInfo | undefined;
}

export async function purchaseProSubscription(appUserID?: string | null) {
  return purchaseSubscription(PRO_SUBSCRIPTION.planId, appUserID);
}

export async function purchaseWalletTopUp(productId: string, appUserID?: string | null) {
  const plugin = getPurchasesPlugin();
  if (!plugin) {
    throw new Error("Billing is not ready on this build yet. Finish your store product setup and try again on the native app build.");
  }

  await initBilling(appUserID);
  const knownProduct = WALLET_TOP_UPS.some((topUp) => topUp.productId === productId);
  if (!knownProduct) {
    throw new Error(`Unknown wallet top-up product: ${productId}`);
  }

  const productResult = await plugin.getProducts({ productIdentifiers: [productId], type: PRODUCT_CATEGORY.NON_SUBSCRIPTION });
  const storeProduct = productResult?.products?.[0] || productResult?.[0];

  if (!storeProduct) {
    throw new Error(`Wallet top-up product not found: ${productId}`);
  }

  const result = await plugin.purchaseStoreProduct({ product: storeProduct });
  await plugin.syncPurchases?.().catch(() => undefined);
  return result;
}

export async function restoreBillingPurchases(appUserID?: string | null) {
  const plugin = getPurchasesPlugin();
  if (!plugin) {
    throw new Error("Billing restore is not ready on this build.");
  }

  await initBilling(appUserID);
  const result = await plugin.restorePurchases();
  await plugin.syncPurchases?.().catch(() => undefined);
  return result?.customerInfo as CustomerInfo | undefined;
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
