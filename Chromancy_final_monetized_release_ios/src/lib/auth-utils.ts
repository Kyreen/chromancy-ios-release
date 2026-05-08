import { buildApiUrl } from "./api-base";

let apiHealthCache: { ok: boolean; checkedAt: number } | null = null;
let apiHealthWarmupInFlight: Promise<void> | null = null;
const API_HEALTH_CACHE_MS = 30 * 60 * 1000;
const API_HEALTH_TIMEOUT_MS = 900;

function warmApiHealthCache() {
  if (apiHealthWarmupInFlight) return apiHealthWarmupInFlight;

  let timeoutId: number | undefined;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;

  apiHealthWarmupInFlight = (async () => {
    try {
      timeoutId = window.setTimeout(() => controller?.abort(), API_HEALTH_TIMEOUT_MS);
      const response = await fetch(buildApiUrl("/api/health"), {
        cache: "no-store",
        headers: { "Cache-Control": "no-store" },
        signal: controller?.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload?.aiConfigured) {
        apiHealthCache = { ok: true, checkedAt: Date.now() };
        return;
      }
      if (response.ok && payload?.aiConfigured === false) {
        apiHealthCache = null;
      }
    } catch {
      // Transient warmup issues should never block the real AI request path.
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      apiHealthWarmupInFlight = null;
    }
  })();

  return apiHealthWarmupInFlight;
}

export async function ensureApiKey(): Promise<boolean> {
  if (apiHealthCache?.ok && Date.now() - apiHealthCache.checkedAt < API_HEALTH_CACHE_MS) {
    return true;
  }

  void warmApiHealthCache();
  return true;
}

export function isLoginRequiredError(error: unknown) {
  const status = Number((error as any)?.status || 0);
  const message = String((error as any)?.message || error || "").toLowerCase();
  return status === 401 ||
    message.includes("login verification") ||
    message.includes("login is required") ||
    message.includes("auth token") ||
    message.includes("authentication");
}
