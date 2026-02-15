import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
import { sha256Hex } from "@/server/crypto";

function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function makeApiKey(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const accessRequestId = BigInt(id);

  const token = getBearerToken(req);
  if (!token) return new Response("Missing Authorization: Bearer <pollToken>", { status: 401 });
  const tokenHash = sha256Hex(token);

  const ar = await prisma.accessRequest.findUnique({
    where: { id: accessRequestId },
    select: {
      id: true,
      status: true,
      pollTokenHash: true,
      accountId: true,
      claimedAt: true,
    },
  });

  if (!ar) return new Response("Access request not found", { status: 404 });
  if (ar.pollTokenHash !== tokenHash) return new Response("Invalid poll token", { status: 403 });
  if (ar.status !== "approved" || !ar.accountId) return new Response("Not approved", { status: 409 });
  if (ar.claimedAt) return new Response("Already claimed", { status: 409 });

  const result = await prisma.$transaction(async (tx) => {
    // Mark claimed first to prevent double-claim.
    await tx.accessRequest.update({
      where: { id: ar.id },
      data: { claimedAt: new Date(), deliveredAt: new Date() },
      select: { id: true },
    });

    const apiKey = makeApiKey();
    const hash = sha256Hex(apiKey);

    await tx.apiKey.create({
      data: { accountId: ar.accountId!, hash },
      select: { id: true },
    });

    return { apiKey };
  });

  return json({ ok: true, apiKey: result.apiKey }, { status: 201 });
}
