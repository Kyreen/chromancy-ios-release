import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layout } from "./components/Layout";
import { LoadingScreen } from "./components/LoadingScreen";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Toaster, toast } from "sonner";
import { auth, completeGoogleRedirectIfPresent, ensureAuthPersistenceReady, subscribeToUserProfile } from "./lib/firebase";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { initBilling } from "./lib/billing";
import { UserProfile, UserTier } from "./types";
import { App as CapacitorApp } from "@capacitor/app";
import { hasAskedNotificationPermission, requestNotificationsWithPrompt } from "./lib/notifications";
import { warmLocalPhotoProcessor } from "./lib/localMedia";
import { refreshUsageSnapshot } from "./lib/pricing";
import { initClientCrashReporting } from "./lib/crashReporting";

const TERMS_VERSION = "chromancy_terms_v1";
const NAV_RESUME_STATE_KEY = "chromancy_nav_resume_state_v2";
const NAV_RESUME_MAX_AGE_MS = 2 * 60 * 1000;

const Home = lazy(() => import("./pages/Home").then((m) => ({ default: m.Home })));
const FixDesign = lazy(() => import("./pages/FixDesign").then((m) => ({ default: m.FixDesign })));
const PhotoEnhancer = lazy(() => import("./pages/PhotoEnhancer").then((m) => ({ default: m.PhotoEnhancer })));
const VideoEnhancer = lazy(() => import("./pages/VideoEnhancer").then((m) => ({ default: m.VideoEnhancer })));
const BusinessTools = lazy(() => import("./pages/BusinessTools").then((m) => ({ default: m.BusinessTools })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy").then((m) => ({ default: m.PrivacyPolicy })));
const TermsOfUse = lazy(() => import("./pages/TermsOfUse").then((m) => ({ default: m.TermsOfUse })));
const SubscriptionPage = lazy(() => import("./pages/SubscriptionPage").then((m) => ({ default: m.SubscriptionPage })));
const DataSafetyPage = lazy(() => import("./pages/DataSafetyPage").then((m) => ({ default: m.DataSafetyPage })));
const AuthPage = lazy(() => import("./pages/AuthPage").then((m) => ({ default: m.AuthPage })));
const LocalHistoryPage = lazy(() => import("./pages/LocalHistoryPage").then((m) => ({ default: m.LocalHistoryPage })));

export default function App() {
  const [activeTab, setActiveTab] = useState("home");
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [billingTier, setBillingTier] = useState<UserTier | null>(null);
  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(false);
  const navigationStackRef = useRef<string[]>(["home"]);
  const backPressRef = useRef(0);
  const activeTabRef = useRef("home");

  useEffect(() => {
    initClientCrashReporting();
  }, []);

  const validTabs = useMemo(
    () =>
      new Set([
        "home",
        "fix",
        "photo",
        "video",
        "business",
        "wallet",
        "history",
        "settings",
        "auth",
        "privacy",
        "terms",
        "subscribe",
        "dataSafety",
      ]),
    []
  );

  useEffect(() => {
    navigationStackRef.current = ["home"];

    try {
      const raw = sessionStorage.getItem(NAV_RESUME_STATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { activeTab?: string; stack?: string[]; savedAt?: number; mode?: string } | null;
      const isRecent = typeof parsed?.savedAt === "number" && Date.now() - parsed.savedAt <= NAV_RESUME_MAX_AGE_MS;
      if (!parsed || parsed.mode !== "background" || !isRecent) {
        sessionStorage.removeItem(NAV_RESUME_STATE_KEY);
        return;
      }

      const restoredStack = Array.isArray(parsed.stack) ? parsed.stack.filter((tab) => validTabs.has(tab)) : [];
      const restoredTab = parsed.activeTab && validTabs.has(parsed.activeTab) ? parsed.activeTab : "home";
      navigationStackRef.current = restoredStack.length ? restoredStack : [restoredTab];
      setActiveTab(restoredTab);
    } catch {
      navigationStackRef.current = ["home"];
      try {
        sessionStorage.removeItem(NAV_RESUME_STATE_KEY);
      } catch {}
    }
  }, [validTabs]);

  const navigateTo = useCallback(
    (tab: string, options?: { replace?: boolean }) => {
      const nextTab = validTabs.has(tab) ? tab : "home";

      setActiveTab((current) => {
        if (current === nextTab) return current;
        const stack = navigationStackRef.current;
        if (options?.replace && stack.length > 0) {
          stack[stack.length - 1] = nextTab;
        } else {
          stack.push(nextTab);
        }
        return nextTab;
      });
    },
    [validTabs]
  );

  const navigateBack = useCallback(() => {
    const stack = navigationStackRef.current;
    if (stack.length > 1) {
      stack.pop();
      setActiveTab(stack[stack.length - 1] || "home");
      return true;
    }
    setActiveTab("home");
    return false;
  }, []);

  useEffect(() => {
    try {
      setHasAcceptedTerms(localStorage.getItem(TERMS_VERSION) === "accepted");
    } catch {
      setHasAcceptedTerms(false);
    }
  }, []);

  useEffect(() => {
    activeTabRef.current = activeTab;
    try {
      sessionStorage.setItem(
        NAV_RESUME_STATE_KEY,
        JSON.stringify({ activeTab, stack: navigationStackRef.current, savedAt: Date.now(), mode: "foreground" })
      );
      window.history.replaceState({ tab: activeTab }, "", `${window.location.pathname}#${activeTab}`);
    } catch {
      // no-op
    }
  }, [activeTab]);

  useEffect(() => {
    const onBackButton = async () => {
      if (navigationStackRef.current.length > 1) {
        navigateBack();
        return;
      }

      const now = Date.now();
      if (now - backPressRef.current < 1400) {
        try {
          sessionStorage.removeItem(NAV_RESUME_STATE_KEY);
        } catch {}
        await CapacitorApp.exitApp();
        return;
      }
      backPressRef.current = now;
      toast("Press back again to close CHROMANCY");
    };

    const listenerPromise = CapacitorApp.addListener("backButton", onBackButton);
    return () => {
      listenerPromise.then((listener) => listener.remove()).catch(() => undefined);
    };
  }, [navigateBack]);

  useEffect(() => {
    if (hasAskedNotificationPermission()) return;

    const timer = window.setTimeout(async () => {
      const allow = window.confirm("Allow CHROMANCY to send notifications for exports, reminders, and updates?");
      if (!allow) {
        localStorage.setItem("chromancy_notifications_enabled", "false");
        localStorage.setItem("chromancy_notifications_asked", "true");
        return;
      }
      await requestNotificationsWithPrompt();
    }, 900);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const finishPendingGoogleLogin = async () => {
      try {
        const redirectUser = await completeGoogleRedirectIfPresent();
        if (redirectUser) {
          navigateTo("settings", { replace: true });
          toast.success("Logged in successfully");
          return;
        }

        const pendingGoogle = localStorage.getItem("chromancy_google_signin_pending") === "1";
        if (pendingGoogle && auth.currentUser) {
          localStorage.removeItem("chromancy_google_signin_pending");
          navigateTo("settings", { replace: true });
          toast.success("Logged in successfully");
        }
      } catch {
        // no-op
      }
    };

    finishPendingGoogleLogin();

    let unsubscribeProfile: (() => void) | null = null;
    let unsubscribeAuth: (() => void) | null = null;

    void (async () => {
      await ensureAuthPersistenceReady().catch(() => undefined);
      unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
        setUser(firebaseUser);

        if (unsubscribeProfile) {
          unsubscribeProfile();
          unsubscribeProfile = null;
        }

        if (firebaseUser) {
          await initBilling(firebaseUser.uid).catch(() => undefined);
          unsubscribeProfile = subscribeToUserProfile(firebaseUser.uid, setProfile);
          refreshUsageSnapshot("free")
            .then((snapshot) => setBillingTier(snapshot.tier || null))
            .catch(() => setBillingTier(null));

          const pendingGoogle = localStorage.getItem("chromancy_google_signin_pending") === "1";
          if (pendingGoogle || activeTabRef.current === "auth") {
            localStorage.removeItem("chromancy_google_signin_pending");
            navigateTo("settings", { replace: true });
            toast.success("Logged in successfully");
          }
        } else {
          setProfile(null);
          setBillingTier(null);
        }

        setIsLoading(false);
      });
    })();

    const urlListenerPromise = CapacitorApp.addListener("appUrlOpen", async () => {
      await finishPendingGoogleLogin();
    });

    const stateListenerPromise = CapacitorApp.addListener("appStateChange", async ({ isActive }) => {
      try {
        if (isActive) {
          const raw = sessionStorage.getItem(NAV_RESUME_STATE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as { activeTab?: string; stack?: string[]; savedAt?: number; mode?: string } | null;
            const isRecent = typeof parsed?.savedAt === "number" && Date.now() - parsed.savedAt <= NAV_RESUME_MAX_AGE_MS;
            if (parsed?.mode === "background" && isRecent) {
              const restoredStack = Array.isArray(parsed.stack) ? parsed.stack.filter((tab) => validTabs.has(tab)) : [];
              const restoredTab = parsed?.activeTab && validTabs.has(parsed.activeTab) ? parsed.activeTab : "home";
              navigationStackRef.current = restoredStack.length ? restoredStack : [restoredTab];
              setActiveTab(restoredTab);
            } else if (parsed?.mode === "background" && !isRecent) {
              navigationStackRef.current = ["home"];
              setActiveTab("home");
            }
          }
          sessionStorage.setItem(
            NAV_RESUME_STATE_KEY,
            JSON.stringify({ activeTab: activeTabRef.current, stack: navigationStackRef.current, savedAt: Date.now(), mode: "foreground" })
          );
        } else {
          sessionStorage.setItem(
            NAV_RESUME_STATE_KEY,
            JSON.stringify({ activeTab: activeTabRef.current, stack: navigationStackRef.current, savedAt: Date.now(), mode: "background" })
          );
        }
      } catch {}
      if (isActive) {
        if (auth.currentUser) {
          refreshUsageSnapshot("free")
            .then((snapshot) => setBillingTier(snapshot.tier || null))
            .catch(() => undefined);
        }
        await finishPendingGoogleLogin();
      }
    });

    return () => {
      unsubscribeAuth?.();
      unsubscribeProfile?.();
      urlListenerPromise.then((listener) => listener.remove()).catch(() => undefined);
      stateListenerPromise.then((listener) => listener.remove()).catch(() => undefined);
    };
  }, [navigateTo, validTabs]);

  useEffect(() => {
    const setViewportVars = () => {
      const vv = window.visualViewport;
      const height = vv?.height ?? window.innerHeight;
      const offsetTop = vv?.offsetTop ?? 0;
      const bottomInset = Math.max(0, window.innerHeight - height - offsetTop);

      document.documentElement.style.setProperty("--app-height", `${height}px`);
      document.documentElement.style.setProperty("--viewport-offset-top", `${offsetTop}px`);
      document.documentElement.style.setProperty("--viewport-offset-bottom", `${bottomInset}px`);
    };

    setViewportVars();
    window.addEventListener("resize", setViewportVars, { passive: true });
    window.addEventListener("orientationchange", setViewportVars, { passive: true });
    window.visualViewport?.addEventListener("resize", setViewportVars, { passive: true });
    window.visualViewport?.addEventListener("scroll", setViewportVars, { passive: true });

    return () => {
      window.removeEventListener("resize", setViewportVars);
      window.removeEventListener("orientationchange", setViewportVars);
      window.visualViewport?.removeEventListener("resize", setViewportVars);
      window.visualViewport?.removeEventListener("scroll", setViewportVars);
    };
  }, []);

  useEffect(() => {
    const preloadMap: Record<string, () => Promise<unknown>> = {
      fix: () => import("./pages/FixDesign"),
      photo: () => import("./pages/PhotoEnhancer"),
      video: () => import("./pages/VideoEnhancer"),
      business: () => import("./pages/BusinessTools"),
      settings: () => import("./pages/Settings"),
      privacy: () => import("./pages/PrivacyPolicy"),
      terms: () => import("./pages/TermsOfUse"),
      subscribe: () => import("./pages/SubscriptionPage"),
      dataSafety: () => import("./pages/DataSafetyPage"),
      auth: () => import("./pages/AuthPage"),
    };

    const run = () => preloadMap[activeTab]?.().catch(() => undefined);

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const id = (window as any).requestIdleCallback(run, { timeout: 1200 });
      return () => (window as any).cancelIdleCallback?.(id);
    }

    const timeout = globalThis.setTimeout(run, 250);
    return () => globalThis.clearTimeout(timeout);
  }, [activeTab]);

  useEffect(() => {
    const warm = () => {
      warmLocalPhotoProcessor().catch(() => undefined);
    };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const id = (window as any).requestIdleCallback(warm, { timeout: 1800 });
      return () => (window as any).cancelIdleCallback?.(id);
    }

    const timeout = globalThis.setTimeout(warm, 1200);
    return () => globalThis.clearTimeout(timeout);
  }, []);

  const handleAcceptTerms = () => {
    try {
      localStorage.setItem(TERMS_VERSION, "accepted");
    } catch {
      // no-op
    }
    setHasAcceptedTerms(true);
  };

  const tier = billingTier || profile?.tier || "free";

  useEffect(() => {
    const persistNavigationState = () => {
      try {
        const hidden = document.visibilityState === "hidden";
        sessionStorage.setItem(
          NAV_RESUME_STATE_KEY,
          JSON.stringify({
            activeTab: activeTabRef.current,
            stack: navigationStackRef.current,
            savedAt: Date.now(),
            mode: hidden ? "background" : "foreground",
          })
        );
      } catch {}
    };

    document.addEventListener("visibilitychange", persistNavigationState, { passive: true });
    window.addEventListener("pagehide", persistNavigationState, { passive: true });
    return () => {
      document.removeEventListener("visibilitychange", persistNavigationState);
      window.removeEventListener("pagehide", persistNavigationState);
    };
  }, []);

  const content = useMemo(() => {
    if (!hasAcceptedTerms) {
      return <TermsOfUse onAccept={handleAcceptTerms} />;
    }

    switch (activeTab) {
      case "home":
        return <Home onNavigate={navigateTo} tier={tier} />;
      case "fix":
        return <FixDesign tier={tier} onNavigate={navigateTo} />;
      case "photo":
        return <PhotoEnhancer tier={tier} onNavigate={navigateTo} />;
      case "video":
        return <VideoEnhancer tier={tier} onNavigate={navigateTo} />;
      case "business":
        return <BusinessTools tier={tier} onNavigate={navigateTo} />;
      case "wallet":
        return <SubscriptionPage user={user} profile={profile} tier={tier} onBack={navigateBack} initialView="unlock" onTierChange={setBillingTier} />;
      case "history":
        return <LocalHistoryPage onBack={navigateBack} />;
      case "settings":
        return <Settings user={user} profile={profile} tier={tier} onBack={navigateBack} onNavigate={navigateTo} onTierChange={setBillingTier} />;
      case "auth":
        return <AuthPage onBack={navigateBack} onSuccess={() => navigateTo("settings")} />;
      case "privacy":
        return <PrivacyPolicy onBack={navigateBack} />;
      case "terms":
        return <TermsOfUse onAccept={() => navigateTo("settings")} onBack={navigateBack} />;
      case "subscribe":
        return <SubscriptionPage user={user} profile={profile} tier={tier} onBack={navigateBack} initialView="premium" onTierChange={setBillingTier} />;
      case "dataSafety":
        return <DataSafetyPage onBack={navigateBack} />;
      default:
        return <Home onNavigate={navigateTo} tier={tier} />;
    }
  }, [activeTab, hasAcceptedTerms, tier, user, profile, navigateTo, navigateBack]);

  if (isLoading) return <LoadingScreen />;

  return (
  <div
    style={{
      minHeight: "var(--app-height, 100dvh)",
      height: "var(--app-height, 100dvh)",
      paddingTop: "env(safe-area-inset-top)",
      paddingBottom: "env(safe-area-inset-bottom)",
      boxSizing: "border-box",
      overflow: "hidden",
      background: "#000",
    }}
  >
    <ErrorBoundary>
      {hasAcceptedTerms ? (
        <Layout activeTab={activeTab} setActiveTab={navigateTo} tier={tier} user={user} profile={profile}>
          <Suspense fallback={<LoadingScreen />}>{content}</Suspense>
        </Layout>
      ) : (
        <Suspense fallback={<LoadingScreen />}>{content}</Suspense>
      )}
      <Toaster
        theme="dark"
        position="top-center"
        toastOptions={{
          style: {
            background: "#1a1a1a",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "#fff",
            borderRadius: "1rem",
            fontFamily: "Roboto, sans-serif",
          },
        }}
      />
    </ErrorBoundary>
  </div>
);
}
