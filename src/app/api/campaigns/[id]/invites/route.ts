import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
import { sha256Hex } from "@/server/crypto";
import { requireAgentForCampaign } from "@/server/auth";
import { parsePositiveBigInt } from "@/server/ids";

function makeInviteCode(): string {
  return crypto.randomBytes(18).toString("base64url");
}

/**
 * Create a GM-controlled single-use invite code for players.
 * Constraints:
 * - GM-only
 * - player-only
 * - single-use (remainingUses starts at 1)
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const campaignId = parsePositiveBigInt(id);
  if (campaignId === null) return json({ error: "Invalid campaign id" }, { status: 400 });

  const gm = await requireAgentForCampaign(req, campaignId);
  if (gm.role !== "gm") return new Response("GM role required", { status: 403 });
  const openSession = await prisma.session.findFirst({ where: { campaignId, status: "created" }, select: { id: true } });
  if (!openSession) return new Response("Campaign membership is locked after the session starts", { status: 409 });

  const code = makeInviteCode();
  const codeHash = sha256Hex(code);

  const invite = await prisma.campaignInvite.create({
    data: {
      campaignId,
      createdByAgentId: gm.id,
      codeHash,
      remainingUses: 1,
    },
    select: { id: true, campaignId: true, remainingUses: true, createdAt: true },
  });

  // Return the raw code ONCE.
  return json({ ok: true, invite, inviteCode: code }, { status: 201 });
}
