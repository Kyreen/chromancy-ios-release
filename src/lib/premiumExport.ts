import { toast } from "sonner";
import { UnlockCategory, getBundlePricing, hasBundleAgreementAccepted, setBundleAgreementAccepted, setSubscriptionView } from "./pricing";

export async function requestPremiumExportUnlock(category: UnlockCategory, onNavigate?: (tab: string) => void) {
  const pricing = getBundlePricing(category);
  if (!hasBundleAgreementAccepted(category)) {
    const agreed = window.confirm(`${pricing.label}: AI wallet pricing ${pricing.displayPrice}. ${pricing.summary} ${pricing.note} Continue to wallet?`);
    if (!agreed) return;
    setBundleAgreementAccepted(category);
  }

  setSubscriptionView("unlock");
  toast.info(`Open wallet pricing for ${pricing.label}.`);
  onNavigate?.("subscribe");
}
