import type { Currency } from "./gateway-defs";

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? "").trim());
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export interface FeeConfig {
  fee?: unknown;
  feeFixed?: unknown;
}

/**
 * What the customer pays so that the seller keeps the price after the gateway's cut: the price,
 * plus the percentage, plus the fixed amount. Everything is in minor units (cents or poisha-free
 * whole taka for BDT: taka are kept as whole numbers, rounded up so the seller is never short).
 */
export function amountWithFees(baseMinor: number, config: FeeConfig, currency: Currency): number {
  const percent = num(config.fee);
  const fixed = num(config.feeFixed);
  if (currency === "BDT") {
    // BDT is handled in whole taka (the price list uses whole taka).
    return Math.ceil(baseMinor * (1 + percent / 100) + fixed);
  }
  return Math.ceil(baseMinor * (1 + percent / 100) + fixed * 100);
}

/** Formats minor units for people: 2995 USD -> "$29.95", 999 BDT -> "৳999". */
export function formatMoney(minor: number, currency: Currency): string {
  return currency === "BDT" ? `৳${minor}` : `$${(minor / 100).toFixed(2)}`;
}
