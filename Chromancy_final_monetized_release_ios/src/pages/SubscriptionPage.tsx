import { useEffect, useState } from "react";
import { ChevronLeft, Check, Crown, LockKeyhole, Sparkles } from "lucide-react";
import { User as FirebaseUser } from "firebase/auth";
import { UserProfile, UserTier } from "../types";
import { getTierFromCustomerInfo, purchaseSubscription, purchaseWalletTopUp } from "../lib/billing";
import { toast } from "sonner";
import {
  formatZarUsd,
  formatZarAmount,
  getSubscriptionView,
  getWalletTopUpLabel,
  premiumMonthlyPricing,
  refreshUsageSnapshot,
  setSubscriptionView,
  subscriptionPlanPricing,
  waitForUsageSnapshot,
  type SubscriptionView,
} from "../lib/pricing";
import type { UsageSnapshot } from "../lib/serverUsage";
import { SUPPORTED_WALLET_COUNTRIES, WALLET_TOP_UPS } from "../lib/toolConfig";
import { isSubscriberTier } from "../lib/tier";

interface SubscriptionPageProps {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  tier: UserTier;
  onBack: () => void;
  initialView?: SubscriptionView;
}

function formatCents(cents = 0) {
  return `R${(Math.max(0, cents) / 100).toFixed(2)}`;
}

function getBillingErrorMessage(error: unknown, fallback: string) {
  const message = String((error as any)?.message || error || "");
  const lower = message.toLowerCase();

  if (lower.includes("device or user is not allowed") || lower.includes("not allowed to make a purchase")) {
    return "This Google Play account or device is not allowed to make purchases yet. Use your Play license tester account and install the internal testing build from Play Console.";
  }

  return message || fallback;
}

export function SubscriptionPage({ user, profile, tier, onBack, initialView }: SubscriptionPageProps) {
  const [selectedView, setSelectedViewState] = useState<SubscriptionView>(initialView || getSubscriptionView());
  const [usageSnapshot, setUsageSnapshot] = useState<UsageSnapshot | null>(null);

  useEffect(() => {
    const nextView = initialView || getSubscriptionView();
    setSelectedViewState(nextView);
    setSubscriptionView(nextView);
    refreshUsageSnapshot(tier).then(setUsageSnapshot).catch(() => undefined);
  }, [tier, user?.uid, initialView]);

  const setSelectedView = (view: SubscriptionView) => {
    setSubscriptionView(view);
    setSelectedViewState(view);
  };

  const ensureLogin = async () => {
    if (user) return user;
    toast.error("Please log in from the Account page first. Use email login on the Android app build.");
    return null;
  };

  const activeSubscriptionPlanId = usageSnapshot?.wallet?.subscription?.planId || null;

  const getSubscriptionButtonLabel = (planId: string) => {
    if (activeSubscriptionPlanId === planId) return "Current plan";
    return planId === "premium" ? "Subscribe to Premium" : "Subscribe to Pro";
  };

  const getPlanSubtitle = (planId: string, credits: number) => {
    return planId === "premium" ? `${credits} AI Credits` : `${credits} AI Credits Monthly`;
  };

  const getPlanFeatures = (planId: string) => {
    return planId === "premium"
      ? ["Monthly Unlimited Beam Mode", "No Beam Mode Watermark", "HD Exports", "Priority Processing"]
      : ["Unlimited Beam Mode", "No Beam Mode Watermark", "HD Exports"];
  };

  const handleSubscribe = async (planId: string) => {
    if (activeSubscriptionPlanId === planId) {
      toast.success("This subscription is already active");
      return;
    }

    try {
      const activeUser = await ensureLogin();
      if (!activeUser) return;
      const customerInfo = await purchaseSubscription(planId, activeUser.uid);
      const nextTier = getTierFromCustomerInfo(customerInfo);
      const snapshot = await waitForUsageSnapshot(
        (nextSnapshot) => nextSnapshot.wallet?.subscription?.planId === planId && nextSnapshot.wallet?.subscription?.isActive === true,
        { tier: isSubscriberTier(nextTier) ? nextTier : "free", timeoutMs: 25000, intervalMs: 1500 },
      );
      setUsageSnapshot(snapshot);
      if (snapshot.wallet?.subscription?.planId === planId && snapshot.wallet?.subscription?.isActive) {
        toast.success("Subscription activated");
      } else {
        toast.success("Purchase submitted. Subscription will unlock as soon as store validation finishes.");
      }
      setSelectedView("premium");
    } catch (error: any) {
      toast.error(getBillingErrorMessage(error, "Subscription purchase failed"));
    }
  };

  const handleWalletTopUp = async (productId: string, amountZar: number) => {
    const agreed = window.confirm(
      `Buy R${amountZar} wallet credit + VAT. Google Play will show the final localized price and tax/VAT where applicable.`,
    );
    if (!agreed) return;

    try {
      const activeUser = await ensureLogin();
      if (!activeUser) return;
      const previousBalance = usageSnapshot?.wallet?.balanceCents || 0;
      const previousDebt = usageSnapshot?.wallet?.debtCents || 0;
      await purchaseWalletTopUp(productId, activeUser.uid);
      const snapshot = await waitForUsageSnapshot(
        (nextSnapshot) =>
          (nextSnapshot.wallet?.balanceCents || 0) > previousBalance ||
          (nextSnapshot.wallet?.debtCents || 0) < previousDebt,
        { tier, timeoutMs: 25000, intervalMs: 1500 },
      );
      setUsageSnapshot(snapshot);
      toast.success("Wallet purchase complete. Balance updated after store validation.");
    } catch (error: any) {
      toast.error(getBillingErrorMessage(error, "Wallet top-up failed"));
    }
  };

  const walletBalance = usageSnapshot?.wallet?.balanceCents || 0;
  const walletDebt = usageSnapshot?.wallet?.debtCents || 0;
  const proCredits = usageSnapshot?.wallet?.proCreditsRemaining || 0;
  const transactions = usageSnapshot?.transactionHistory || [];
  const proPlan = subscriptionPlanPricing.find((plan) => plan.planId === "pro");
  const premiumPlan = subscriptionPlanPricing.find((plan) => plan.planId === "premium");

  return (
    <div className="flex flex-col h-full bg-black">
      <div className="p-4 flex items-center gap-4 border-b border-white/5">
        <button onClick={onBack} className="p-2 rounded-full bg-white/5 border border-white/10">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold tracking-tight">Plans</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-2 gap-3 rounded-3xl border border-white/10 bg-white/5 p-2">
          <button
            type="button"
            onClick={() => setSelectedView("premium")}
            className={`rounded-2xl px-4 py-3 text-xs font-bold uppercase tracking-widest transition-all ${selectedView === "premium" ? "bg-white text-black" : "text-white/60 hover:bg-white/5"}`}
          >
            Subscriptions
          </button>
          <button
            type="button"
            onClick={() => setSelectedView("unlock")}
            className={`rounded-2xl px-4 py-3 text-xs font-bold uppercase tracking-widest transition-all ${selectedView === "unlock" ? "bg-white text-black" : "text-white/60 hover:bg-white/5"}`}
          >
            Wallet
          </button>
        </div>

        <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 to-white/5 p-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-white text-black px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] mb-4">
            {selectedView === "premium" ? <Crown className="w-3 h-3" /> : <LockKeyhole className="w-3 h-3" />} CHROMANCY {selectedView === "premium" ? "Premium" : "Wallet"}
          </div>
          {selectedView === "premium" ? (
            <>
              <h3 className="text-2xl font-bold">Plans from {formatZarUsd(premiumMonthlyPricing.zar)} / month</h3>
              <p className="text-sm text-white/50 mt-2">Pro Monthly: {getPlanSubtitle("pro", proPlan?.monthlyAiCredits || 40)}. Premium Monthly: {getPlanSubtitle("premium", premiumPlan?.monthlyAiCredits || 60)}.</p>
            </>
          ) : (
            <>
              <h3 className="text-2xl font-bold">Wallet balance: {formatCents(walletBalance)}</h3>
              <p className="text-sm text-white/50 mt-2">AI wallet prices use R12, R20, and R39 tiers. CREATE currently costs R39 or 3 AI Credits. Wallet top-ups are {getWalletTopUpLabel()}.</p>
            </>
          )}
        </div>

        {user ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Account Wallet</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-xs text-white/45">Wallet credit</div>
                <div className="mt-1 text-xl font-bold">{formatCents(walletBalance)}</div>
                {walletDebt > 0 ? <div className="mt-1 text-[11px] text-red-300/80">Refund debt: {formatCents(walletDebt)}</div> : null}
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-xs text-white/45">Subscription AI credits</div>
                <div className="mt-1 text-xl font-bold">{proCredits}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-xs text-white/45">Subscription</div>
                <div className="mt-1 text-sm font-bold">{usageSnapshot?.wallet?.subscription?.displayName || "None"}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 text-sm text-white/60">Login is required for subscriptions, wallet top-ups, AI generation, and transaction history.</div>
        )}

        {selectedView === "premium" ? (
          <>
            <div className="grid gap-3">
              {subscriptionPlanPricing.map((plan) => (
                <div key={plan.planId} className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-bold">{plan.displayName}</div>
                      <p className="mt-1 text-xs text-white/50">{getPlanSubtitle(plan.planId, plan.monthlyAiCredits)}</p>
                    </div>
                    <div className="text-right text-sm font-bold">R{formatZarAmount(plan.monthlyZar)} incl. VAT</div>
                  </div>
                  <div className="space-y-2 text-xs text-white/60">
                    {getPlanFeatures(plan.planId).map((feature) => (
                      <div key={feature} className="flex items-center gap-2"><Check className="w-3 h-3" /> {feature}</div>
                    ))}
                  </div>
                  <button onClick={() => handleSubscribe(plan.planId)} className="w-full flex items-center justify-center gap-2 p-4 rounded-3xl bg-white text-black font-bold uppercase tracking-widest text-xs hover:bg-white/90 transition-all">
                    <Sparkles className="w-4 h-4" />
                    {getSubscriptionButtonLabel(plan.planId)}
                  </button>
                </div>
              ))}
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-white/60">
                If subscription credits run out, AI tools fall back to wallet pricing. Before each paid AI generation, CHROMANCY shows the exact wallet-fund or AI-credit cost. Failed AI generations are refunded or released.
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="text-sm font-bold">Supported wallet countries</div>
              <p className="mt-2 text-xs text-white/50">
                {Object.values(SUPPORTED_WALLET_COUNTRIES).map((country) => `${country.label} (${country.currency})`).join(" | ")}
              </p>
            </div>

            {WALLET_TOP_UPS.map((topUp) => (
              <div key={topUp.productId} className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-bold">Wallet Top-up R{topUp.zar} + VAT</div>
                  </div>
                  <div className="text-right text-sm font-bold">R{topUp.zar} + VAT</div>
                </div>
                <button onClick={() => handleWalletTopUp(topUp.productId, topUp.zar)} className="w-full p-3 rounded-2xl border border-white/10 bg-black/40 font-bold uppercase tracking-widest text-xs hover:bg-white/10 transition-all">
                  Buy R{topUp.zar} + VAT
                </button>
              </div>
            ))}

            <div className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-3">
              <div className="text-sm font-bold">Transaction History</div>
              {transactions.length ? transactions.map((transaction) => (
                <div key={transaction.id} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-white/60">{transaction.type}</div>
                    <div className="text-sm font-bold">{transaction.amountCents >= 0 ? "+" : "-"}{formatCents(Math.abs(transaction.amountCents))}</div>
                  </div>
                  <div className="mt-1 text-[11px] text-white/40">{new Date(transaction.createdAt).toLocaleString()}</div>
                  {transaction.toolName ? <div className="mt-1 text-[11px] text-white/45">{transaction.toolName}</div> : null}
                  {transaction.note ? <div className="mt-1 text-[11px] text-white/45">{transaction.note}</div> : null}
                </div>
              )) : (
                <p className="text-xs text-white/45">No wallet transactions yet.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
