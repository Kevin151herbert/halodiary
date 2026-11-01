import { createHash } from "node:crypto";
import type { Terms } from "./contract";

/** Fingerprint of exactly what was signed: parties, schedule, price and terms. */
export function fingerprint(parts: { planId: string; clientId: string; providerId: string; version: number; price: number; terms: Terms }) {
  const canonical = JSON.stringify({
    plan: parts.planId,
    client: parts.clientId,
    provider: parts.providerId,
    version: parts.version,
    price: Number(parts.price).toFixed(2),
    terms: Object.fromEntries(Object.entries(parts.terms).sort(([a], [b]) => a.localeCompare(b))),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

