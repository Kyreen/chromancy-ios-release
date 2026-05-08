const DEVICE_KEY = "chromancy_device_id_session_v1";
let memoryDeviceId: string | null = null;

function randomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `dev_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

export function getDeviceId() {
  if (memoryDeviceId) return memoryDeviceId;
  try {
    const existing = sessionStorage.getItem(DEVICE_KEY);
    if (existing) {
      memoryDeviceId = existing;
      return existing;
    }
    const created = randomId();
    memoryDeviceId = created;
    sessionStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    const created = randomId();
    memoryDeviceId = created;
    return created;
  }
}

export function clearDeviceId() {
  memoryDeviceId = null;
  try {
    sessionStorage.removeItem(DEVICE_KEY);
  } catch {
    // no-op
  }
}
