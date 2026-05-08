import { auth } from "./firebase";
import { buildApiUrl } from "./api-base";

type CrashContext = Record<string, unknown>;

const CRASH_LOGS_ENABLED = String(import.meta.env.VITE_CHROMANCY_CRASH_LOGS_ENABLED || "false") === "true";
const MAX_TEXT_LENGTH = 2400;

let initialized = false;
let sendInFlight = false;

function sanitizeCrashText(value: unknown, maxLength = MAX_TEXT_LENGTH) {
  return String(value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key|token|secret|password)["'\s:=]+[A-Za-z0-9._~+/=-]+/gi, "$1=[redacted]")
    .slice(0, maxLength);
}

function getErrorPayload(error: unknown) {
  if (error instanceof Error) {
    return {
      name: sanitizeCrashText(error.name, 120),
      message: sanitizeCrashText(error.message, 500),
      stack: sanitizeCrashText(error.stack, MAX_TEXT_LENGTH),
    };
  }

  if (typeof error === "object" && error) {
    const value = error as { name?: unknown; message?: unknown; stack?: unknown };
    return {
      name: sanitizeCrashText(value.name || "Error", 120),
      message: sanitizeCrashText(value.message || JSON.stringify(value), 500),
      stack: sanitizeCrashText(value.stack, MAX_TEXT_LENGTH),
    };
  }

  return {
    name: "Error",
    message: sanitizeCrashText(error, 500),
    stack: "",
  };
}

export async function reportClientCrash(error: unknown, context: CrashContext = {}) {
  if (!CRASH_LOGS_ENABLED || sendInFlight) return;
  sendInFlight = true;

  try {
    const token = await auth.currentUser?.getIdToken().catch(() => null);
    const payload = {
      ...getErrorPayload(error),
      source: sanitizeCrashText(context.source || "client", 80),
      route: sanitizeCrashText(window.location.href, 220),
      platform: sanitizeCrashText(navigator.platform || "web", 80),
      userAgent: sanitizeCrashText(navigator.userAgent, 500),
      appVersion: sanitizeCrashText(import.meta.env.VITE_APP_VERSION || "unknown", 80),
      context,
    };

    await fetch(buildApiUrl("/api/client-crash"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => undefined);
  } finally {
    sendInFlight = false;
  }
}

export function initClientCrashReporting() {
  if (!CRASH_LOGS_ENABLED || initialized || typeof window === "undefined") return;
  initialized = true;

  window.addEventListener("error", (event) => {
    reportClientCrash(event.error || event.message, {
      source: "window-error",
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportClientCrash(event.reason, { source: "unhandled-rejection" });
  });
}
