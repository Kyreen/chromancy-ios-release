import { useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { ChevronLeft, KeyRound, LoaderCircle, LogIn, Mail, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Logo } from "../components/Logo";
import { createAccountWithEmail, loginWithEmail, loginWithGoogle, sendForgotPasswordEmail } from "../lib/firebase";

interface AuthPageProps {
  onBack: () => void;
  onSuccess: () => void;
}

function getFirebaseAuthMessage(error: any) {
  const code = error?.code || "";
  const message = String(error?.message || "");

  if (message.includes("Google sign-in is missing its Web client ID")) {
    return "Google sign-in is not configured yet. Add the required Firebase client IDs for this platform and rebuild the app.";
  }

  if (message.includes("Google sign-in did not return an ID token")) {
    return "Google sign-in could not complete. Please try again.";
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
      return "Google sign-in was closed before it finished.";
    case "auth/unauthorized-domain":
      return "This login domain is not authorized in Firebase yet. Add chromancy.online and api.chromancy.online in Firebase Auth settings.";
    case "auth/operation-not-allowed":
      return "This login method is not enabled in Firebase yet.";
    case "auth/network-request-failed":
      return "Network connection failed. Please check your internet and try again.";
    default:
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

  return (
    <div className="flex flex-col h-full bg-black text-white">
      <div className="safe-area-top p-4 flex items-center gap-4 border-b border-white/5">
        <button onClick={onBack} className="p-2 rounded-full bg-white/5 border border-white/10">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold tracking-tight">Account</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-md mx-auto space-y-6">
          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 text-center">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[1.5rem] border border-white/10 bg-black/40">
              <Logo className="w-14 h-14" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">CHROMANCY</h1>
            <p className="mt-2 text-sm text-white/50">Sign in or create an account. Your device can save your login details with its password manager.</p>
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

          <div className="space-y-4 rounded-[2rem] border border-white/10 bg-white/5 p-5">
            {mode === "create" && (
              <label className="block space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Name</span>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-4 text-sm outline-none transition focus:border-white/30"
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
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-4 text-sm outline-none transition focus:border-white/30"
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
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-4 text-sm outline-none transition focus:border-white/30"
              />
            </label>

            <button
              onClick={handleEmailSubmit}
              disabled={isBusy || isResettingPassword}
              className="w-full flex items-center justify-center gap-2 rounded-3xl bg-white px-4 py-4 text-xs font-bold uppercase tracking-widest text-black transition hover:bg-white/90 disabled:opacity-60"
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

            {!isNativeIos ? (
              <>
                <div className="flex items-center gap-3 py-1">
                  <div className="h-px flex-1 bg-white/10" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">or</span>
                  <div className="h-px flex-1 bg-white/10" />
                </div>

                <button
                  onClick={handleGoogleSignIn}
                  disabled={isBusy || isResettingPassword}
                  className="w-full flex items-center justify-center gap-2 rounded-3xl border border-white/10 bg-black/40 px-4 py-4 text-xs font-bold uppercase tracking-widest transition hover:bg-white/5 disabled:opacity-60"
                >
                  {isBusy ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                  Log in with Google
                </button>
              </>
            ) : (
              <p className="text-center text-[11px] leading-5 text-white/45">
                Email login is available on iPhone. Google sign-in is disabled on iOS so this App Store build stays compliant until a matching Sign in with Apple flow is added.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


