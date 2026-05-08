import type { UserTier } from "../types";

export function isSubscriberTier(tier?: UserTier | null) {
  return tier === "pro" || tier === "premium";
}

export function getTierLabel(tier?: UserTier | null) {
  if (tier === "premium") return "Premium Plan";
  if (tier === "pro") return "Pro Plan";
  if (tier === "pay-as-you-use") return "Wallet Plan";
  return "Free Plan";
}
