import { useEffect, useReducer } from "react";

// Lightweight ZAR/USD display-currency layer.
// - Prices are stored in ZAR everywhere; this converts for DISPLAY only.
// - Live rate is fetched from a free, no-key FX endpoint with a cached fallback.
// NOTE: actual in-app purchases (wallet top-ups / subscriptions) are charged by
// the App Store / Play Store in the user's store currency — this toggle changes
// what we DISPLAY, not what the store ultimately charges.

export type Currency = "ZAR" | "USD";

const CURRENCY_KEY = "chromancy_currency";
const RATE_KEY = "chromancy_zar_per_usd";
const DEFAULT_ZAR_PER_USD = 18.5;

function readStoredRate(): number {
  try {
    const stored = Number(localStorage.getItem(RATE_KEY));
    return stored > 0 && Number.isFinite(stored) ? stored : DEFAULT_ZAR_PER_USD;
  } catch {
    return DEFAULT_ZAR_PER_USD;
  }
}

let zarPerUsd = readStoredRate();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => {
    try { fn(); } catch { /* ignore */ }
  });
}

export function onCurrencyChange(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getCurrency(): Currency {
  try {
    return localStorage.getItem(CURRENCY_KEY) === "USD" ? "USD" : "ZAR";
  } catch {
    return "ZAR";
  }
}

export function setCurrency(currency: Currency) {
  try { localStorage.setItem(CURRENCY_KEY, currency); } catch { /* ignore */ }
  emit();
}

export function getZarPerUsd() {
  return zarPerUsd;
}

export function setZarPerUsd(rate: number) {
  if (rate > 0 && Number.isFinite(rate)) {
    zarPerUsd = rate;
    try { localStorage.setItem(RATE_KEY, String(rate)); } catch { /* ignore */ }
    emit();
  }
}

let lastFetch = 0;
let inFlight = false;
export async function refreshLiveRate() {
  // Refresh at most every 30 minutes; fall back silently to the cached rate.
  if (inFlight || Date.now() - lastFetch < 30 * 60 * 1000) return;
  inFlight = true;
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    if (res.ok) {
      const json = await res.json();
      const rate = Number(json?.rates?.ZAR);
      if (rate > 0 && Number.isFinite(rate)) {
        lastFetch = Date.now();
        setZarPerUsd(rate);
      }
    }
  } catch {
    // keep last-known / fallback rate
  } finally {
    inFlight = false;
  }
}

export function convertFromZar(zar: number, currency: Currency = getCurrency()) {
  return currency === "USD" ? zar / zarPerUsd : zar;
}

export function formatMoney(zar: number, currency: Currency = getCurrency()): string {
  const amount = Number(zar) || 0;
  if (currency === "USD") {
    return `$${(amount / zarPerUsd).toFixed(2)}`;
  }
  return Number.isInteger(amount) ? `R${amount}` : `R${amount.toFixed(2)}`;
}

export function formatMoneyFromCents(cents: number, currency: Currency = getCurrency()): string {
  return formatMoney((Number(cents) || 0) / 100, currency);
}

// React hook: re-renders the component whenever the currency OR the live rate changes.
export function useCurrency() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const off = onCurrencyChange(force);
    void refreshLiveRate();
    return off;
  }, []);
  const currency = getCurrency();
  return {
    currency,
    setCurrency,
    formatMoney: (zar: number) => formatMoney(zar, currency),
    formatMoneyFromCents: (cents: number) => formatMoneyFromCents(cents, currency),
  };
}
