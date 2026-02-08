import { headers } from "next/headers";

/**
 * Build an absolute base URL for server-side fetch() calls.
 * Works in dev and behind reverse proxies.
 */
export async function getBaseUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";

  if (!host) {
    // Fallback for rare environments.
    return process.env.AQ_BASE_URL ?? "http://localhost:3000";
  }

  return `${proto}://${host}`;
}
