const DEFAULT_API_BASE_URL = "https://api.chromancy.online";

export function buildApiUrl(path: string) {
  const configuredBaseUrl = typeof import.meta.env.VITE_API_BASE_URL === "string"
    ? import.meta.env.VITE_API_BASE_URL.trim()
    : "";
  const baseUrl = (configuredBaseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}
