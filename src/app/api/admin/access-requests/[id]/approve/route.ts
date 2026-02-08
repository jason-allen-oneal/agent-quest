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
  requireAdmin(req);

  const { id } = await ctx.params;
  const accessRequestId = BigInt(id);

  const body = await req.json().catch(() => ({}));
  const decisionNote = body?.decisionNote ? String(body.decisionNote).slice(0, 1000) : null;

  const ar = await prisma.accessRequest.findUnique({
    where: { id: accessRequestId },
    select: {
      id: true,
      status: true,
      campaignId: true,
      requestedRole: true,
      name: true,
      characterName: true,
    },
  });
  if (!ar) return new Response("Access request not found", { status: 404 });
  if (ar.status !== "pending") return new Response("Access request not pending", { status: 409 });

  const result = await prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.findUnique({ where: { id: ar.campaignId }, select: { settings: true } });
    const settings = (campaign?.settings ?? {}) as Record<string, unknown>;

    // Optional enforcement: campaign.settings.requiredTags (string[])
    const requiredTagsRaw = (settings as Record<string, unknown>).requiredTags;
    const requiredTags = Array.isArray(requiredTagsRaw) ? requiredTagsRaw.map((t) => String(t)) : [];


    // Load request tags
    const arFull = await tx.accessRequest.findUnique({ where: { id: ar.id }, select: { tags: true, botId: true } });
    const requestTagsRaw = arFull?.tags;
    const requestTags = Array.isArray(requestTagsRaw) ? requestTagsRaw.map((t) => String(t)) : [];
    const botId = arFull?.botId ? String(arFull.botId) : null;

    for (const rt of requiredTags) {
      if (!requestTags.includes(rt)) {
        throw new Error(`Missing required tag: ${rt}`);
      }
    }

    // Optional enforcement: campaign.settings.roleCaps { gm:number, player:number, observer:number }
    const roleCapsRaw = (settings as Record<string, unknown>).roleCaps;
    const roleCaps = roleCapsRaw && typeof roleCapsRaw === "object" ? (roleCapsRaw as Record<string, unknown>) : null;
    if (roleCaps) {
      const capRaw = roleCaps[ar.requestedRole];
      const cap = typeof capRaw === "number" ? capRaw : null;
      if (cap !== null) {
        const count = await tx.agent.count({ where: { campaignId: ar.campaignId, role: ar.requestedRole } });
        if (count >= cap) throw new Error(`Role cap reached for ${ar.requestedRole}`);
      }
    }

    // Optional enforcement: limit number of campaigns a bot can GM.
    // Convention: env AQ_MAX_GM_CAMPAIGNS_PER_BOT (default 1) or campaign.settings.maxGmCampaignsPerBot
    const maxGmRaw = (settings as Record<string, unknown>).maxGmCampaignsPerBot;
    const maxGmEnv = Number(process.env.AQ_MAX_GM_CAMPAIGNS_PER_BOT ?? 1);
    const maxGm = typeof maxGmRaw === "number" ? maxGmRaw : maxGmEnv;

    if (ar.requestedRole === "gm") {
      if (!botId) throw new Error("GM access requests must include botId");
      const gmCount = await tx.agent.count({ where: { botId, role: "gm" } });
      if (gmCount >= maxGm) throw new Error(`GM campaign limit reached (${maxGm})`);
    }

    // Create agent (character is selected later by agent via /api/characters/me)
    const agent = await tx.agent.create({
      data: {
        campaignId: ar.campaignId,
        characterId: null,
        role: ar.requestedRole,
        name: ar.name,
        botId,
      },
      select: { id: true, campaignId: true, role: true, name: true, characterId: true, botId: true },
    });

    // Mark request approved (bind to created agent)
    await tx.accessRequest.update({
      where: { id: ar.id },
      data: { status: "approved", agentId: agent.id, decidedAt: new Date(), decisionNote },
      select: { id: true },
    });

    // Optional legacy claim-link support (not required for automatic flow)
    const token = makeClaimToken();
    const tokenHash = sha256Hex(token);
    const expiresAt = new Date(Date.now() + CLAIM_TTL_HOURS * 60 * 60 * 1000);

    await tx.apiKeyClaim.create({
      data: {
        accessRequestId: ar.id,
        agentId: agent.id,
        tokenHash,
        expiresAt,
      },
      select: { id: true },
    });

    return { agent, token, expiresAt };
  });

  const origin = new URL(req.url).origin;
  const claimUrl = `${origin}/claim/${result.token}`;

  return json({ ok: true, agent: result.agent, claimUrl, expiresAt: result.expiresAt }, { status: 201 });
}
