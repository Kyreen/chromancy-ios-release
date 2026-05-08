import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

const PREF_KEY = "chromancy_notifications_enabled";
const ASKED_KEY = "chromancy_notifications_asked";

export function isNotificationsEnabled(): boolean {
  return localStorage.getItem(PREF_KEY) === "true";
}

export function setNotificationsEnabled(enabled: boolean) {
  localStorage.setItem(PREF_KEY, enabled ? "true" : "false");
}

export function hasAskedNotificationPermission(): boolean {
  return localStorage.getItem(ASKED_KEY) === "true";
}

function markAsked() {
  localStorage.setItem(ASKED_KEY, "true");
}

export async function requestNotificationsWithPrompt(): Promise<"granted" | "denied"> {
  markAsked();

  if (Capacitor.isNativePlatform()) {
    const current = await LocalNotifications.checkPermissions();
    if (current.display === "granted") {
      setNotificationsEnabled(true);
      return "granted";
    }

    const requested = await LocalNotifications.requestPermissions();
    const granted = requested.display === "granted";
    setNotificationsEnabled(granted);
    if (granted) {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: Date.now() % 2147483647,
            title: "CHROMANCY notifications enabled",
            body: "You'll now receive app alerts when notifications are switched on.",
            schedule: { at: new Date(Date.now() + 1200) },
          },
        ],
      }).catch(() => undefined);
      return "granted";
    }
    return "denied";
  }

  if (!("Notification" in window)) {
    setNotificationsEnabled(false);
    return "denied";
  }

  if (Notification.permission === "granted") {
    setNotificationsEnabled(true);
    return "granted";
  }

  const permission = await Notification.requestPermission();
  const granted = permission === "granted";
  setNotificationsEnabled(granted);
  return granted ? "granted" : "denied";
}

export async function disableNotifications(): Promise<void> {
  setNotificationsEnabled(false);
  if (Capacitor.isNativePlatform()) {
    await LocalNotifications.cancel({ notifications: [] }).catch(() => undefined);
  }
}

