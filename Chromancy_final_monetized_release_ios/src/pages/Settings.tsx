import React, { useMemo, useState } from "react";
import {
  User,
  ShieldCheck,
  Bell,
  Smartphone,
  HelpCircle,
  ChevronRight,
  ChevronLeft,
  LogOut,
  FileText,
  RefreshCcw,
  Trash2,
  Database,
  Crown,
  FileCheck,
  KeyRound,
  Mail,
} from "lucide-react";
import { cn } from "../lib/utils";
import { UserTier, UserProfile } from "../types";
import { EmailAuthProvider, User as FirebaseUser, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { deleteCurrentUserAccount, logout, updateUserProfile } from "../lib/firebase";
import { getTierFromCustomerInfo, restoreBillingPurchases } from "../lib/billing";
import { toast } from "sonner";
import { getWalletTopUpLabel, refreshUsageSnapshot, setSubscriptionView, waitForUsageSnapshot } from "../lib/pricing";
import { disableNotifications, isNotificationsEnabled, requestNotificationsWithPrompt } from "../lib/notifications";
import { buildApiUrl } from "../lib/api-base";
import { isSubscriberTier } from "../lib/tier";

interface SettingsProps {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  tier: UserTier;
  onBack: () => void;
  onNavigate: (tab: string) => void;
}

function isStrongPassword(password: string) {
  return /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z\d]).{6,}$/.test(password);
}

const SUPPORT_EMAIL = "info@chromancy.online";
const APP_VERSION = "1.0.24";

export function Settings({ user, profile, tier, onBack, onNavigate }: SettingsProps) {
  const [isRestoring, setIsRestoring] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [helpSubject, setHelpSubject] = useState("");
  const [helpMessage, setHelpMessage] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [notificationsEnabled, setNotificationsEnabledState] = useState(isNotificationsEnabled());
  const [isSendingHelp, setIsSendingHelp] = useState(false);
  const notificationStatus = useMemo(() => (notificationsEnabled ? "Enabled" : "Disabled"), [notificationsEnabled]);
  const handleLogout = async () => {
    try {
      await logout();
      toast.success("Successfully logged out");
      onNavigate("home");
    } catch {
      toast.error("Sign out failed");
    }
  };

  const handleRestore = async () => {
    if (!user) {
      toast.error("Log in to restore your subscription");
      return;
    }

    setIsRestoring(true);
    try {
      const customerInfo = await restoreBillingPurchases(user.uid);
      const nextTier = getTierFromCustomerInfo(customerInfo);
      const snapshotTier = isSubscriberTier(nextTier) ? nextTier : tier;
      const immediateSnapshot = await refreshUsageSnapshot(snapshotTier).catch(() => null);
      const snapshot = immediateSnapshot?.wallet?.subscription?.isActive
        ? immediateSnapshot
        : await waitForUsageSnapshot(
          (nextSnapshot) => nextSnapshot.wallet?.subscription?.isActive === true,
          { tier: snapshotTier, timeoutMs: isSubscriberTier(nextTier) ? 12000 : 5000, intervalMs: 800 },
        ).catch(() => immediateSnapshot);

      if (snapshot?.wallet?.subscription?.isActive) {
        toast.success("Subscription restored");
      } else if (!isSubscriberTier(nextTier)) {
        toast.success("No active premium subscription found");
      } else {
        toast.success("Restore submitted. Subscription will appear after store validation finishes.");
      }
    } catch (error: any) {
      toast.error(error?.message || "Restore failed");
    } finally {
      setIsRestoring(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) {
      toast.error("You need to be logged in first");
      return;
    }

    const needsPassword = user.providerData.some((provider) => provider.providerId === "password");
    if (needsPassword && !deletePassword.trim()) {
      toast.error("Enter your current password before deleting your account.");
      return;
    }

    const confirmed = window.confirm("Delete your CHROMANCY account and project data? This cannot be undone.");
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await deleteCurrentUserAccount(deletePassword);
      setDeletePassword("");
      toast.success("Account successfully deleted");
      onNavigate("home");
    } catch (error: any) {
      toast.error(error?.message || "Account deletion failed. Please sign in again and try once more.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleNotificationSetting = async () => {
    try {
      if (notificationsEnabled) {
        await disableNotifications();
        setNotificationsEnabledState(false);
        toast.success("Notifications disabled");
        return;
      }

      const result = await requestNotificationsWithPrompt();
      const enabled = result === "granted";
      setNotificationsEnabledState(enabled);
      if (enabled) {
        toast.success("Notifications enabled");
      } else {
        toast.error("Notification permission was denied on this device.");
      }
    } catch {
      toast.error("Could not update notifications.");
    }
  };

  const handleProfileSave = async () => {
    if (!user) return;
    try {
      if (displayName.trim() && displayName.trim() !== user.displayName) {
        await updateUserProfile(user.uid, { displayName: displayName.trim() });
      }

      if (newPassword.trim()) {
        if (!currentPassword.trim()) {
          toast.error("Enter your current password first.");
          return;
        }
        if (!isStrongPassword(newPassword)) {
          toast.error("New password must contain letters, numbers, and a special character, and be at least 6 characters long.");
          return;
        }
        if (!user.email) {
          toast.error("This account does not support password changes here.");
          return;
        }
        const credential = EmailAuthProvider.credential(user.email, currentPassword);
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, newPassword);
      }

      toast.success("Profile updated successfully");
      setCurrentPassword("");
      setNewPassword("");
      setShowProfileEditor(false);
    } catch (error: any) {
      toast.error(error?.message || "Profile update failed");
    }
  };

  const sendHelpRequest = async () => {
    const subject = helpSubject.trim() || "CHROMANCY Help Request";
    const message = helpMessage.trim() || "Hi, I need help with CHROMANCY.";
    const fromName = user?.displayName || profile?.displayName || "CHROMANCY user";
    const fromEmail = user?.email || profile?.email || "";

    const openSupportComposer = () => {
      const body = [
        `From name: ${fromName}`,
        `From email: ${fromEmail || "Not provided"}`,
        "",
        message,
      ].join("\n");
      window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`[CHROMANCY Help] ${subject}`)}&body=${encodeURIComponent(body)}`;
      toast.success(`Opening your email app for ${SUPPORT_EMAIL}`);
    };

    setIsSendingHelp(true);
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 6000);
      const response = await fetch(buildApiUrl("/api/help-request"), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          subject,
          message,
          fromName,
          fromEmail,
        }),
      });
      window.clearTimeout(timeout);

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(data?.error || "In-app help is unavailable right now. Your email app will open instead.");
        openSupportComposer();
        return;
      }

      setHelpSubject("");
      setHelpMessage("");
      toast.success("Help request sent");
    } catch (error: any) {
      toast.error(error?.name === "AbortError" ? "In-app help timed out. Your email app will open instead." : "In-app help is unavailable right now. Your email app will open instead.");
      openSupportComposer();
    } finally {
      setIsSendingHelp(false);
    }
  };

  const sections = [
    {
      title: "Account",
      items: [
        { icon: User, label: "Profile Information", value: user?.displayName || "User", onClick: () => setShowProfileEditor((v) => !v), hasArrow: true },
        { icon: ShieldCheck, label: "Subscription Plan", value: isSubscriberTier(tier) ? "Active" : undefined, onClick: () => { setSubscriptionView("premium"); onNavigate("subscribe"); }, hasArrow: true },
        { icon: Crown, label: "Wallet Top-ups", onClick: () => { setSubscriptionView("unlock"); onNavigate("subscribe"); }, hasArrow: true },
        { icon: RefreshCcw, label: "Restore Purchase", value: isRestoring ? "Restoring..." : undefined, onClick: handleRestore, hasArrow: false },
        { icon: Crown, label: "Upgrade to Premium", value: isSubscriberTier(tier) ? "Active" : undefined, onClick: () => { setSubscriptionView("premium"); onNavigate("subscribe"); }, hasArrow: true },
      ],
    },
    {
      title: "Settings",
      items: [
        { icon: Bell, label: "Notifications", value: notificationStatus, onClick: handleNotificationSetting, hasArrow: false },
        { icon: Smartphone, label: "App Version", value: APP_VERSION, onClick: () => undefined, hasArrow: false },
      ],
    },
    {
      title: "Privacy & Data",
      items: [
        { icon: FileText, label: "Privacy Policy", onClick: () => onNavigate("privacy"), hasArrow: true },
        { icon: FileCheck, label: "Terms of Use", onClick: () => onNavigate("terms"), hasArrow: true },
        { icon: Database, label: "Data Safety", onClick: () => onNavigate("dataSafety"), hasArrow: true },
        { icon: Trash2, label: "Delete Account", value: isDeleting ? "Deleting..." : undefined, onClick: handleDeleteAccount, hasArrow: false },
      ],
    },
  ];

  return (
    <div className="flex flex-col h-full bg-black">
      <div className="p-4 flex items-center gap-4 border-b border-white/5">
        <button onClick={onBack} className="p-2 rounded-full bg-white/5 border border-white/10">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold tracking-tight">Settings</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        <div className="flex items-center gap-4 p-6 rounded-3xl bg-white/5 border border-white/10">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center overflow-hidden border-2 border-white/10">
            {user?.photoURL ? <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <User className="w-8 h-8 text-white/70" />}
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-lg">{user?.displayName || "User"}</h3>
            <p className="text-xs text-white/40">{user?.email || "Log in to manage purchases"}</p>
          </div>
        </div>

        {showProfileEditor && user && (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold"><User className="w-4 h-4" /> Profile Information</div>
            <label className="block space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Username</span>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-4 text-sm outline-none transition focus:border-white/30" />
            </label>
            <label className="block space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Email</span>
              <input value={user.email || ""} disabled className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-white/50" />
            </label>
            <label className="block space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Current password</span>
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-4 text-sm outline-none transition focus:border-white/30" />
            </label>
            <label className="block space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">New password</span>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-4 text-sm outline-none transition focus:border-white/30" />
            </label>
            <button onClick={handleProfileSave} className="w-full flex items-center justify-center gap-2 p-4 rounded-3xl bg-white text-black font-bold uppercase tracking-widest text-xs hover:bg-white/90 transition-all">
              <KeyRound className="w-4 h-4" /> Save Profile
            </button>
          </div>
        )}

        {sections.map((section, idx) => (
          <div key={idx} className="space-y-3">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-white/30 px-2">{section.title}</h4>
            <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
              {section.items.map((item, itemIdx) => (
                <button key={itemIdx} onClick={item.onClick} className={cn("w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors text-left", itemIdx !== section.items.length - 1 && "border-b border-white/5")}>
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="p-2 rounded-xl bg-white/5">
                      <item.icon className="w-4 h-4 text-white/70" />
                    </div>
                    <span className="whitespace-nowrap text-sm font-medium">{item.label}</span>
                  </div>
                  <div className="ml-3 flex min-w-0 shrink items-center gap-2">
                    {item.value && <span className="truncate whitespace-nowrap text-right text-xs text-white/40">{item.value}</span>}
                    {item.hasArrow ? <ChevronRight className="h-4 w-4 shrink-0 text-white/20" /> : null}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}


        {user?.providerData.some((provider) => provider.providerId === "password") && (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold"><Trash2 className="w-4 h-4" /> Delete account confirmation</div>
            <label className="block space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Current password</span>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                autoComplete="current-password"
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-4 text-sm outline-none transition focus:border-white/30"
              />
            </label>
          </div>
        )}

        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold"><Crown className="w-4 h-4" /> AI Wallet</div>
          <p className="text-xs text-white/50 leading-6">Wallet top-ups are {getWalletTopUpLabel()}. AI tools use R12, R20, or R39 wallet tiers. Subscription details are listed on the Plans page.</p>
          <button onClick={() => { setSubscriptionView("unlock"); onNavigate("subscribe"); }} className="w-full flex items-center justify-center gap-2 p-4 rounded-3xl border border-white/10 bg-black/20 font-bold uppercase tracking-widest text-xs hover:bg-white/5 transition-all">
            Open Wallet &amp; Transaction History
          </button>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold"><HelpCircle className="w-4 h-4" /> Help Center</div>
          <p className="text-xs text-white/50 leading-6">Help requests are sent to {SUPPORT_EMAIL}. If in-app sending is unavailable, CHROMANCY will open your email app with the message prefilled.</p>
          <label className="block space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Subject</span>
            <input value={helpSubject} onChange={(e) => setHelpSubject(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-4 text-sm outline-none transition focus:border-white/30" />
          </label>
          <label className="block space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Message</span>
            <textarea value={helpMessage} onChange={(e) => setHelpMessage(e.target.value)} rows={5} className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-4 text-sm outline-none transition focus:border-white/30" />
          </label>
          <button onClick={sendHelpRequest} disabled={isSendingHelp} className="w-full flex items-center justify-center gap-2 p-4 rounded-3xl border border-white/10 bg-black/20 font-bold uppercase tracking-widest text-xs hover:bg-white/5 transition-all disabled:opacity-60 disabled:cursor-not-allowed">
            <Mail className="w-4 h-4" /> {isSendingHelp ? "Sending..." : "Send Help Request"}
          </button>
        </div>

        {user && (
          <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 p-4 rounded-3xl border border-red-500/20 bg-red-500/5 text-red-400 font-bold uppercase tracking-widest text-xs hover:bg-red-500/10 transition-all">
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        )}
      </div>
    </div>
  );
}
