import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { prisma } from "./db.ts";

export type RateLimitRule = {
  id: string;
  limit: number;
  windowMs: number;
  discriminator?: string;
  scope?: "ip" | "subject" | "global";
};

export function getClientIp(req: NextRequest): string {
  // Only trust the value our reverse proxy overwrites. Never accept the first
  // X-Forwarded-For hop: clients can forge it.
  if (process.env.AQ_TRUST_PROXY === "true") {
    const trusted = req.headers.get("x-real-ip")?.trim();
    if (trusted && trusted.length <= 64) return trusted;
  }
  // @ts-expect-error Next exposes this in some runtimes.
  const runtimeIp: string | undefined = req.ip;
  return runtimeIp?.slice(0, 64) || "direct";
}

function digest(rule: RateLimitRule, ip: string): string {
  const identity = rule.scope === "global" ? "global" : rule.scope === "subject" ? (rule.discriminator ?? "missing") : `${ip}\0${rule.discriminator ?? ""}`;
  return crypto
    .createHash("sha256")
    .update(`${rule.id}\0${identity}`)
    .digest("hex");
}

async function consume(key: string, limit: number, windowMs: number): Promise<Response | null> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);
  await prisma.$executeRaw`
    INSERT INTO RateLimitBucket (\`key\`, \`count\`, \`resetAt\`, \`updatedAt\`)
    VALUES (${key}, 1, ${resetAt}, ${now})
    ON DUPLICATE KEY UPDATE
      \`count\` = IF(\`resetAt\` <= ${now}, 1, \`count\` + 1),
      \`resetAt\` = IF(\`resetAt\` <= ${now}, ${resetAt}, \`resetAt\`),
      \`updatedAt\` = ${now}
  `;
  const bucket = await prisma.rateLimitBucket.findUnique({ where: { key } });
  if (!bucket || bucket.count <= limit) return null;
  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt.getTime() - Date.now()) / 1000));
  return new Response("Too many requests", {
    status: 429,
    headers: { "retry-after": String(retryAfter), "cache-control": "no-store" },
  });
}

export async function rateLimit(req: NextRequest, rule: RateLimitRule): Promise<Response | null> {
  const ip = getClientIp(req);
  return consume(digest(rule, ip), rule.limit, rule.windowMs);
}

export async function rateLimitMany(req: NextRequest, rules: RateLimitRule[]): Promise<Response | null> {
  for (const rule of rules) {
    const limited = await rateLimit(req, rule);
    if (limited) return limited;
  }
  if (Math.random() < 0.01) {
    void prisma.rateLimitBucket.deleteMany({ where: { resetAt: { lt: new Date(Date.now() - 60_000) } } });
  }
  return null;
}
