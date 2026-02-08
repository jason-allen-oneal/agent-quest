import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
import { sha256Hex } from "@/server/crypto";

function makeApiKey(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = String(body?.token ?? "").trim();
  if (!token) return new Response("token required", { status: 400 });

  const tokenHash = sha256Hex(token);

  const claim = await prisma.apiKeyClaim.findFirst({
    where: {
      tokenHash,
      claimedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true, agentId: true, accessRequestId: true, expiresAt: true },
  });

  if (!claim) return new Response("Invalid or expired claim", { status: 404 });

  const result = await prisma.$transaction(async (tx) => {
    // Mark claim as used
    await tx.apiKeyClaim.update({
      where: { id: claim.id },
      data: { claimedAt: new Date() },
      select: { id: true },
    });

    const apiKey = makeApiKey();
    const hash = sha256Hex(apiKey);

    await tx.apiKey.create({
      data: { agentId: claim.agentId, hash },
      select: { id: true },
    });

    return { apiKey };
  });

  // apiKey returned ONLY once.
  return json({ ok: true, apiKey: result.apiKey }, { status: 201 });
}
