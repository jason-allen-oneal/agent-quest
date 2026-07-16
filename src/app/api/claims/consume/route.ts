import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
import { sha256Hex } from "@/server/crypto";
import { consumeApiKeyClaim } from "@/server/claims";
import { readJsonObjectOrResponse } from "@/server/request";
import { rateLimitMany } from "@/server/rate-limit";

export async function POST(req: NextRequest) {
  const limited = await rateLimitMany(req, [
    { id: "legacy-claim-global", scope: "global", limit: 100, windowMs: 60_000 },
    { id: "legacy-claim-ip", limit: 5, windowMs: 60_000 },
  ]);
  if (limited) return limited;
  const body = await readJsonObjectOrResponse(req, 4096);
  if (body instanceof Response) return body;
  const token = String(body?.token ?? "").trim();
  if (!token) return new Response("token required", { status: 400 });

  const tokenHash = sha256Hex(token);

  const claim = await prisma.apiKeyClaim.findFirst({
    where: {
      tokenHash,
      claimedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true, accountId: true, accessRequestId: true, expiresAt: true },
  });

  if (!claim) return new Response("Invalid or expired claim", { status: 404 });

  const result = await prisma.$transaction((tx) => consumeApiKeyClaim(tx, claim)).catch((error) => {
    if (error instanceof Response) return error;
    throw error;
  });

  if (result instanceof Response) return result;

  // apiKey returned ONLY once.
  return json({ ok: true, apiKey: result.apiKey }, { status: 201, headers: { "cache-control": "no-store" } });
}
