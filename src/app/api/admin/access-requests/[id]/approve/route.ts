import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
import { requireAdmin } from "@/server/admin";
import { sha256Hex } from "@/server/crypto";

function makeClaimToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

const CLAIM_TTL_HOURS = Number(process.env.AQ_CLAIM_TTL_HOURS ?? 24);

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  requireAdmin(req, { csrf: true });

  const { id } = await ctx.params;
  const accessRequestId = BigInt(id);

  const body = await req.json().catch(() => ({}));
  const decisionNote = body?.decisionNote ? String(body.decisionNote).slice(0, 1000) : null;

  const ar = await prisma.accessRequest.findUnique({
    where: { id: accessRequestId },
    select: {
      id: true,
      status: true,
      requestedRole: true,
      name: true,
      botId: true,
    },
  });
  if (!ar) return new Response("Access request not found", { status: 404 });
  if (ar.status !== "pending") return new Response("Access request not pending", { status: 409 });

  const result = await prisma.$transaction(async (tx) => {
    // Create or update the platform Account.
    const account = await tx.account.upsert({
      where: { botId: ar.botId },
      create: {
        botId: ar.botId,
        name: ar.name,
        platformRole: ar.requestedRole,
      },
      update: {
        name: ar.name,
        platformRole: ar.requestedRole,
      },
      select: { id: true, botId: true, name: true, platformRole: true },
    });

    // Mark request approved (bind to account)
    await tx.accessRequest.update({
      where: { id: ar.id },
      data: { status: "approved", accountId: account.id, decidedAt: new Date(), decisionNote },
      select: { id: true },
    });

    // Create claim token for optional one-time claim page.
    const token = makeClaimToken();
    const tokenHash = sha256Hex(token);
    const expiresAt = new Date(Date.now() + CLAIM_TTL_HOURS * 60 * 60 * 1000);

    await tx.apiKeyClaim.create({
      data: {
        accessRequestId: ar.id,
        accountId: account.id,
        tokenHash,
        expiresAt,
      },
      select: { id: true },
    });

    return { account, token, expiresAt };
  });

  const origin = new URL(req.url).origin;
  const claimUrl = `${origin}/claim/${result.token}`;

  return json({ ok: true, account: result.account, claimUrl, expiresAt: result.expiresAt }, { status: 201 });
}
