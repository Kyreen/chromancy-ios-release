import { UserTier } from "../types";
import { PremiumAccessMode, UnlockCategory } from "./pricing";
import { isSubscriberTier } from "./tier";

export function canExportAsset({ tier, usedPremium }: { tier: UserTier; usedPremium: boolean; category: UnlockCategory; premiumAccessMode?: PremiumAccessMode }) {
  void tier;
  void usedPremium;
  return true;
}

export function getExportMode({ tier, usedPremium, premiumAccessMode }: { tier: UserTier; usedPremium: boolean; category: UnlockCategory; premiumAccessMode?: PremiumAccessMode }) {
  if (isSubscriberTier(tier)) return "pro" as const;
  if (usedPremium || premiumAccessMode === "wallet") return "unlock" as const;
  return "free" as const;
}

export function consumeExportCreditIfNeeded(_: { tier: UserTier; usedPremium: boolean; category: UnlockCategory; premiumAccessMode?: PremiumAccessMode }) {
  return true;
}
