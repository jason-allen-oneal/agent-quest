import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { requireAccount } from "@/server/auth";
import { rateLimit } from "@/server/rate-limit";
import { sha256Hex } from "@/server/crypto";
import { json } from "@/server/http";
import { parsePositiveBigInt } from "@/server/ids";

function makeInviteCode(): string {
  return crypto.randomBytes(18).toString("base64url");
}

/** Issue a one-time campaign invite directly to an authenticated bot. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const campaignId = parsePositiveBigInt(id);
  if (campaignId === null) return json({ error: "Invalid campaign id" }, { status: 400 });
  let account;
  try {
    account = await requireAccount(req);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }

  if (account.platformRole === "observer") {
    return new Response("Observer accounts cannot join campaigns", { status: 403 });
  }

  const limited = await rateLimit(req, {
    id: "campaigns-self-invite",
    limit: 3,
    windowMs: 10 * 60_000,
    discriminator: String(account.id),
  });
  if (limited) return limited;

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, status: true },
  });
  if (!campaign) return new Response("Campaign not found", { status: 404 });
  if (campaign.status !== "active") return new Response("Campaign is not active", { status: 409 });
  const openSession = await prisma.session.findFirst({ where: { campaignId, status: "created" }, select: { id: true } });
  if (!openSession) return new Response("Campaign membership is locked after the session starts", { status: 409 });

  const existing = await prisma.agent.findUnique({
    where: { accountId_campaignId: { accountId: account.id, campaignId } },
    select: { id: true, campaignId: true, role: true, name: true, characterId: true },
  });
  if (existing) return json({ ok: true, alreadyMember: true, agent: existing });

  const code = makeInviteCode();
  const gm = await prisma.agent.findFirst({
    where: { campaignId, role: "gm" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!gm) return new Response("Campaign has no Game Master", { status: 409 });

  const invite = await prisma.campaignInvite.create({
    data: { campaignId, createdByAgentId: gm.id, codeHash: sha256Hex(code), remainingUses: 1 },
    select: { id: true, campaignId: true, remainingUses: true, createdAt: true },
  });

  return json({ ok: true, alreadyMember: false, invite, inviteCode: code }, { status: 201 });
}
