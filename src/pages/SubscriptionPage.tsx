import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { ChevronLeft, Crown } from "lucide-react";
import { User as FirebaseUser } from "firebase/auth";
import { UserProfile, UserTier } from "../types";
import { purchaseWalletTopUp } from "../lib/billing";
import { toast } from "sonner";
import {
  getUsageSnapshotCache,
  getWalletTopUpLabel,
  refreshUsageSnapshot,
  waitForUsageSnapshot,
} from "../lib/pricing";
import type { UsageSnapshot } from "../lib/serverUsage";
import { SUPPORTED_WALLET_COUNTRIES, WALLET_TOP_UPS } from "../lib/toolConfig";
import { useCurrency, formatMoney, formatMoneyFromCents } from "../lib/currency";

interface SubscriptionPageProps {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  tier: UserTier;
  onBack: () => void;
}

function formatCents(cents = 0) {
  return formatMoneyFromCents(Math.max(0, cents));
}

function getBillingErrorMessage(error: unknown, fallback: string) {
  const message = String((error as any)?.message || error || "");
  const lower = message.toLowerCase();

  if (lower.includes("device or user is not allowed") || lower.includes("not allowed to make a purchase")) {
    return Capacitor.getPlatform() === "ios"
      ? "This Apple ID or device is not allowed to make purchases yet. Use a Sandbox tester account and install the TestFlight or App Store build."
      : "This Google Play account or device is not allowed to make purchases yet. Use your Play license tester account and install the internal testing build from Play Console.";
  }

  if (lower.includes("already owned") || lower.includes("item_already_owned") || lower.includes("already purchased")) {
    return Capacitor.getPlatform() === "ios"
      ? "This wallet product is being treated as already owned by Apple. Wallet top-ups must be configured as consumable products in App Store Connect and RevenueCat."
      : "This wallet product is being treated as already owned by Google Play. Wallet top-ups must be configured as consumable products in Google Play and RevenueCat so the same amount can be bought more than once.";
  }

  if (lower.includes("problem with the store") || lower.includes("store problem")) {
    return "The store did not complete this purchase. Please check that the wallet product is active, configured as a consumable in the store and RevenueCat, and available to this tester account.";
  }

  return message || fallback;
}

export function SubscriptionPage({ user, profile, tier, onBack }: SubscriptionPageProps) {
  useCurrency();
  // Seed from the last-known cached snapshot so the wallet shows the real balance
  // instantly instead of flashing R0.00 while the network request is in flight.
  const [usageSnapshot, setUsageSnapshot] = useState<UsageSnapshot | null>(() => getUsageSnapshotCache());
  const [isWalletLoading, setIsWalletLoading] = useState(true);

  useEffect(() => {
    setIsWalletLoading(true);
    refreshUsageSnapshot(tier)
      .then(setUsageSnapshot)
      .catch(() => undefined)
      .finally(() => setIsWalletLoading(false));
  }, [tier, user?.uid]);

  const ensureLogin = async () => {
    if (user) return user;
    toast.error("Please log in from the Account page first.");
    return null;
  };

  const handleWalletTopUp = async (productId: string, amountZar: number) => {
    const agreed = window.confirm(
      `Buy R${amountZar} wallet credit + VAT. The store will show the final localized price and tax/VAT where applicable.`,
    );
    if (!agreed) return;

    try {
      const activeUser = await ensureLogin();
      if (!activeUser) return;
      const previousBalance = usageSnapshot?.wallet?.balanceCents || 0;
      const previousDebt = usageSnapshot?.wallet?.debtCents || 0;
      const purchaseResult = await purchaseWalletTopUp(productId, activeUser.uid);
      const syncedSnapshot = (purchaseResult as any)?.snapshot as UsageSnapshot | undefined;
      const hasUpdatedBalance = (nextSnapshot?: UsageSnapshot) =>
        (nextSnapshot?.wallet?.balanceCents || 0) > previousBalance ||
        (nextSnapshot?.wallet?.debtCents || 0) < previousDebt;
      const snapshot = hasUpdatedBalance(syncedSnapshot)
        ? syncedSnapshot!
        : await waitForUsageSnapshot(hasUpdatedBalance, { tier, timeoutMs: 25000, intervalMs: 1500 });
      setUsageSnapshot(snapshot);
      toast.success("Wallet purchase complete. Balance updated after store validation.");
    } catch (error: any) {
      refreshUsageSnapshot(tier).then(setUsageSnapshot).catch(() => undefined);
      toast.error(getBillingErrorMessage(error, "Wallet top-up failed"));
    }
  };

  const walletBalance = usageSnapshot?.wallet?.balanceCents || 0;
  const walletDebt = usageSnapshot?.wallet?.debtCents || 0;
  const proCredits = usageSnapshot?.wallet?.proCreditsRemaining || 0;
  const transactions = usageSnapshot?.transactionHistory || [];

  return (
    <div className="flex flex-col h-full bg-black">
      <div className="p-4 flex items-center gap-4 border-b border-white/5">
        <button onClick={onBack} className="p-2 rounded-full bg-white/5 border border-white/10">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold tracking-tight">Wallet</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 to-white/5 p-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-white text-black px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] mb-4">
            <Crown className="w-3 h-3" /> CHROMANCY Wallet
          </div>
          <>
            <h3 className="text-2xl font-bold">Wallet balance: {formatCents(walletBalance)}{isWalletLoading ? <span className="ml-2 text-sm font-medium text-white/40">updating…</span> : null}</h3>
          </>
        </div>

        {user ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Account Wallet</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-xs text-white/45">Wallet credit</div>
                <div className="mt-1 text-xl font-bold">{formatCents(walletBalance)}</div>
                {walletDebt > 0 ? <div className="mt-1 text-[11px] text-red-300/80">Refund debt: {formatCents(walletDebt)}</div> : null}
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-xs text-white/45">Support credits</div>
                <div className="mt-1 text-xl font-bold">{proCredits}</div>
                <div className="mt-1 text-[11px] text-white/45">Visible only if support granted extra credits manually.</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 text-sm text-white/60">Login is required for wallet top-ups, AI generation, and transaction history.</div>
        )}

        <div className="space-y-3">
          <div className="rounded-3xl border border-white/30 bg-gradient-to-br from-white/10 to-white/[0.03] p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-bold uppercase tracking-wide">↻ Basic AI tools — up to 50% OFF retries</div>
              <span className="shrink-0 whitespace-nowrap rounded-full bg-white text-black px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em]">50% off</span>
            </div>
            <p className="mt-2 text-xs text-white/70">
              Didn't nail it the first time? Run the same basic AI tool again on the same file and your
              second go is <span className="font-bold text-white">up to 50% off</span> — applied automatically.
              Keep refining for less. (The premium CREATE tool stays full price — see Terms.)
            </p>
          </div>

          {WALLET_TOP_UPS.map((topUp) => (
            <div key={topUp.productId} className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-bold">Wallet Top-up {formatMoney(topUp.zar)} + VAT</div>
                </div>
                <div className="text-right text-sm font-bold">{formatMoney(topUp.zar)} + VAT</div>
              </div>
              <button onClick={() => handleWalletTopUp(topUp.productId, topUp.zar)} className="w-full p-3 rounded-2xl border border-white/10 bg-black/40 font-bold uppercase tracking-widest text-xs hover:bg-white/10 transition-all">
                Buy {formatMoney(topUp.zar)} + VAT
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
      </div>
    </div>
  );
}
