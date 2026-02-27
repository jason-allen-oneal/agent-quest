import { NextRequest } from "next/server";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function now() {
  return Date.now();
}

function cleanup(max = 2000) {
  // Opportunistic cleanup to keep memory bounded.
  if (buckets.size <= max) return;
  const t = now();
  for (const [k, b] of buckets) {
    if (b.resetAt <= t) buckets.delete(k);
    if (buckets.size <= max) break;
  }
}

export function getClientIp(req: NextRequest): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) {
    const first = xf.split(",")[0]?.trim();
    if (first) return first;
  }
  const xr = req.headers.get("x-real-ip")?.trim();
  if (xr) return xr;
  // NextRequest.ip exists in some runtimes, but not all.
  // @ts-expect-error - optional runtime field
  const rip: string | undefined = req.ip;
  return rip ?? "unknown";
}

export function rateLimit(
  req: NextRequest,
  opts: {
    id: string;
    limit: number;
    windowMs: number;
    // Additional discriminator like botId, username, etc.
    key?: string;
  },
): Response | null {
  cleanup();

  const ip = getClientIp(req);
  const key = `${opts.id}:${ip}:${opts.key ?? ""}`;

  const t = now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= t) {
    buckets.set(key, { count: 1, resetAt: t + opts.windowMs });
    return null;
  }

  b.count += 1;
  if (b.count <= opts.limit) return null;

  const retryAfterSec = Math.max(1, Math.ceil((b.resetAt - t) / 1000));
  return new Response("Too many requests", {
    status: 429,
    headers: {
      "retry-after": String(retryAfterSec),
    },
  });
}
