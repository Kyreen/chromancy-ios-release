import { useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { ChevronLeft, KeyRound, LoaderCircle, LogIn, Mail, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Logo } from "../components/Logo";
import { createAccountWithEmail, isNativeAppleLoginConfigured, isNativeGoogleLoginConfigured, loginWithApple, loginWithEmail, loginWithGoogle, sendForgotPasswordEmail } from "../lib/firebase";

interface AuthPageProps {
  onBack: () => void;
  onSuccess: () => void;
}

// Official "Left Black Logo" artwork from Apple Design Resources (the Sign in with
// Apple logo download), embedded unmodified: 24x44 canvas with Apple's own glyph
// geometry and built-in padding. Per Apple's guidelines, never crop this artwork,
// never add vertical padding, and never swap it for a generic icon-library apple.
function AppleLogoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 44" width="24" height="44" aria-hidden="true" className={className}>
      <path
        d="M12.2337427,16.9879688 C12.8896607,16.9879688 13.7118677,16.5445313 14.2014966,15.9532812 C14.6449341,15.4174609 14.968274,14.6691602 14.968274,13.9208594 C14.968274,13.8192383 14.9590357,13.7176172 14.9405591,13.6344727 C14.2107349,13.6621875 13.3330982,14.1241016 12.8065162,14.7430664 C12.3907935,15.2142188 12.012024,15.9532812 12.012024,16.7108203 C12.012024,16.8216797 12.0305005,16.9325391 12.0397388,16.9694922 C12.0859302,16.9787305 12.1598365,16.9879688 12.2337427,16.9879688 Z M9.92417241,28.1662891 C10.8202857,28.1662891 11.2175318,27.5658008 12.3353638,27.5658008 C13.4716724,27.5658008 13.721106,28.1478125 14.7188404,28.1478125 C15.6980982,28.1478125 16.3540162,27.2424609 16.972981,26.3555859 C17.6658521,25.339375 17.9522388,24.3416406 17.9707154,24.2954492 C17.9060474,24.2769727 16.0306763,23.5101953 16.0306763,21.3576758 C16.0306763,19.491543 17.5088013,18.6508594 17.5919459,18.5861914 C16.612688,17.1819727 15.1253248,17.1450195 14.7188404,17.1450195 C13.6194849,17.1450195 12.7233716,17.8101758 12.1598365,17.8101758 C11.5501099,17.8101758 10.7463794,17.1819727 9.79483648,17.1819727 C7.98413335,17.1819727 6.14571538,18.6785742 6.14571538,21.5054883 C6.14571538,23.2607617 6.8293482,25.1176563 7.67003179,26.3186328 C8.39061773,27.3348438 9.01882085,28.1662891 9.92417241,28.1662891 Z"
        fill="#000000"
        fillRule="nonzero"
      />
    </svg>
  );
}

function getFirebaseAuthMessage(error: any) {
  const code = error?.code || "";
  const message = String(error?.message || "");
  const lowerMessage = message.toLowerCase();

  // User dismissed the Apple/Google sheet — treat as a friendly cancel, not a
  // scary "capability / failed to start" error. (Apple cancel = code 1001.)
  if (
    String(code) === "1001" ||
    lowerMessage.includes("1001") ||
    lowerMessage.includes("cancel") ||
    lowerMessage.includes("the user canceled") ||
    code === "auth/popup-closed-by-user" ||
    code === "auth/cancelled-popup-request"
  ) {
    return "Sign-in was cancelled.";
  }

  if (message.includes("Google sign-in is missing its Web client ID")) {
    return "Google sign-in is not configured yet. Add the required Firebase client IDs for this platform and rebuild the app.";
  }

  if (message.includes("Google sign-in on iOS is missing")) {
    return "Google sign-in needs the iOS OAuth client ID in this iPhone build. Add VITE_GOOGLE_IOS_CLIENT_ID, then rebuild and sync iOS.";
  }

  if (message.includes("Google sign-in did not return an ID token")) {
    return "Google sign-in could not complete. Please try again.";
  }

  if (message.includes("Apple sign-in did not return an ID token")) {
    return "Apple sign-in could not complete. Please try again.";
  }

  switch (code) {
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/missing-password":
      return "Please enter your password.";
    case "auth/weak-password":
      return "Password must be at least 6 characters and include letters, numbers, and a special character.";
    case "auth/email-already-in-use":
      return "That email address already has an account.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a bit and try again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Sign-in was closed before it finished.";
    case "auth/unauthorized-domain":
      return "This login domain is not authorized in Firebase yet. Add chromancy.online and api.chromancy.online in Firebase Auth settings.";
    case "auth/operation-not-allowed":
      return "This login method is not enabled in Firebase yet.";
    case "auth/network-request-failed":
      return "Network connection failed. Please check your internet and try again.";
    default:
      if (message.toLowerCase().includes("not handled") || message.toLowerCase().includes("authorization")) {
        return "Apple sign-in failed to start. Make sure 'Sign in with Apple' capability is enabled for com.chromancy.app in your Apple Developer account and that the provisioning profile includes it.";
      }
      if (message.toLowerCase().includes("user needs to") || message.toLowerCase().includes("sign in on")) {
        return "Your Apple ID needs attention. Open Settings on your iPhone, confirm Apple ID and Password and Security are fully active, then try again.";
      }
      return error?.message || "Authentication failed. Please try again.";
  }
}


function isStrongPassword(password: string) {
  return /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z\d]).{6,}$/.test(password);
}

export function AuthPage({ onBack, onSuccess }: AuthPageProps) {
  const [mode, setMode] = useState<"signin" | "create">("signin");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const isNativeIos = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  const canUseGoogleLogin = !isNativeIos || isNativeGoogleLoginConfigured();
  const canUseAppleLogin = !isNativeIos || isNativeAppleLoginConfigured();
  const heading = useMemo(() => (mode === "signin" ? "Sign In" : "Create Account"), [mode]);

  const handleEmailSubmit = async () => {
    if (isBusy) return;

    if (!email.trim() || !password.trim() || (mode === "create" && !displayName.trim())) {
      toast.error(mode === "create" ? "Please complete all fields." : "Please enter your email and password.");
      return;
    }

    if (mode === "create" && !isStrongPassword(password)) {
      toast.error("Password must contain letters, numbers, and a special character, and be at least 6 characters long.");
      return;
    }

    setIsBusy(true);
    try {
      if (mode === "signin") {
        await loginWithEmail(email.trim(), password);
        toast.success("Logged in successfully");
      } else {
        await createAccountWithEmail(email.trim(), password, displayName.trim());
        toast.success("Account created successfully");
      }
      onSuccess();
    } catch (error: any) {
      toast.error(getFirebaseAuthMessage(error));
    } finally {
      setIsBusy(false);
    }
  };


  const handleForgotPassword = async () => {
    if (isBusy || isResettingPassword) return;

    if (!email.trim()) {
      toast.error("Enter your email address first.");
      return;
    }

    setIsResettingPassword(true);
    try {
      await sendForgotPasswordEmail(email.trim());
      window.alert("Password reset email sent. If you do not see it soon, please check your junk or spam folder as well.");
      toast.success("Password reset email sent");
    } catch (error: any) {
      toast.error(getFirebaseAuthMessage(error));
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (isBusy) return;

    if (!canUseGoogleLogin) {
      toast.error("Google login needs the iOS OAuth client ID before this iPhone build can use it.");
      return;
    }

    setIsBusy(true);
    try {
      const user = await loginWithGoogle();
      if (user) {
        toast.success("Logged in successfully");
        onSuccess();
      }
    } catch (error: any) {
      toast.error(getFirebaseAuthMessage(error));
    } finally {
      setIsBusy(false);
    }
  };

  const handleAppleSignIn = async () => {
    if (isBusy) return;

    if (!canUseAppleLogin) {
      toast.error("Apple login is only available in the iPhone app.");
      return;
    }

    setIsBusy(true);
    try {
      const user = await loginWithApple();
      if (user) {
        toast.success("Logged in successfully");
        onSuccess();
      }
    } catch (error: any) {
      toast.error(getFirebaseAuthMessage(error));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-black text-white">
      <div className="safe-area-top px-3 py-2 flex items-center gap-4 border-b border-white/5">
        <button onClick={onBack} className="p-2 rounded-full bg-white/5 border border-white/10">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-bold tracking-tight">Account</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="max-w-md mx-auto space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-center">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-[1.5rem] border border-white/10 bg-black/40">
              <Logo className="w-11 h-11" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">CHROMANCY</h1>
            <p className="mt-1 text-xs text-white/50">Sign in or create an account. Your device can save your login details with its password manager.</p>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-3xl border border-white/10 bg-white/5 p-2">
            <button
              onClick={() => setMode("signin")}
              className={`rounded-2xl px-4 py-3 text-xs font-bold uppercase tracking-widest transition-all ${mode === "signin" ? "bg-white text-black" : "text-white/60 hover:bg-white/5"}`}
            >
              Sign In
            </button>
            <button
              onClick={() => setMode("create")}
              className={`rounded-2xl px-4 py-3 text-xs font-bold uppercase tracking-widest transition-all ${mode === "create" ? "bg-white text-black" : "text-white/60 hover:bg-white/5"}`}
            >
              Create Account
            </button>
          </div>

          <div className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4">
            {mode === "create" && (
              <label className="block space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Name</span>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none transition focus:border-white/30"
                />
              </label>
            )}

            <label className="block space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none transition focus:border-white/30"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm outline-none transition focus:border-white/30"
              />
            </label>

            <button
              onClick={handleEmailSubmit}
              disabled={isBusy || isResettingPassword}
              className="w-full flex items-center justify-center gap-2 rounded-3xl bg-white px-4 py-3 text-xs font-bold uppercase tracking-widest text-black transition hover:bg-white/90 disabled:opacity-60"
            >
              {isBusy ? <LoaderCircle className="w-4 h-4 animate-spin" /> : mode === "signin" ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
              {heading}
            </button>

            {mode === "signin" && (
              <button
                onClick={handleForgotPassword}
                disabled={isBusy || isResettingPassword}
                className="w-full flex items-center justify-center gap-2 rounded-3xl border border-white/10 bg-black/20 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-white/70 transition hover:bg-white/5 disabled:opacity-60"
              >
                {isResettingPassword ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                Forgot Password
              </button>
            )}

            <div className="flex items-center gap-3 py-1">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">or</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            <button
              onClick={handleGoogleSignIn}
              disabled={isBusy || isResettingPassword || !canUseGoogleLogin}
              className="w-full flex items-center justify-center gap-2 rounded-3xl border border-white/10 bg-black/40 px-4 py-3 text-xs font-bold uppercase tracking-widest transition hover:bg-white/5 disabled:opacity-60"
            >
              {isBusy ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              Log in with Google
            </button>

            {isNativeIos && (
              // Sign in with Apple button per Apple HIG (verified against the current
              // guidelines): approved title in default capitalization, white style with
              // black logo + title on this dark background, system font at the specified
              // 43% ratio (44pt button -> 19pt title), capsule corner radius (allowed:
              // 0..capsule), full width so it is at least as prominent as other buttons.
              <button
                onClick={handleAppleSignIn}
                disabled={isBusy || isResettingPassword || !canUseAppleLogin}
                className="w-full h-[44px] flex items-center justify-center gap-0 rounded-3xl bg-white px-4 text-[19px] font-medium normal-case tracking-normal text-black transition hover:bg-white/90 disabled:opacity-60"
              >
                {isBusy ? <LoaderCircle className="w-5 h-5 mr-1.5 animate-spin" /> : <AppleLogoIcon className="h-[44px] w-[24px] shrink-0" />}
                Sign in with Apple
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


