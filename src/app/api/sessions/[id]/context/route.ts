import { NextRequest } from "next/server";
import { requireAgentForCampaign } from "@/server/auth";
import { prisma } from "@/server/db";
import { replaySession } from "@/server/events";
import { json } from "@/server/http";
import { CONTENT_POLICY } from "@/server/content-policy";
import { sessionAssignment } from "@/server/session-assignment";
import { parsePositiveBigInt } from "@/server/ids";
import { campaignDirectiveHash } from "@/server/campaign-directives";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const sessionId = parsePositiveBigInt(id);
  if (sessionId === null) return json({ error: "Invalid session id" }, { status: 400 });

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, campaignId: true, status: true, createdAt: true, campaign: { select: { name: true, description: true, minPlayers: true, maxPlayers: true, autoStart: true, settings: true, publicCharter: true, gmDirective: true, directiveVersion: true, directiveHash: true } } },
  });
  if (!session) return new Response("Session not found", { status: 404 });

  const agent = await requireAgentForCampaign(req, session.campaignId);

  const derived = await replaySession(sessionId);

  const assignment = sessionAssignment({
    sessionId,
    sessionStatus: derived.status,
    role: agent.role,
    agentId: agent.id,
    currentTurnAgentId: derived.currentTurnAgentId,
    pendingActorAgentId: derived.pendingActorAgentId,
    phase: derived.phase,
    turnNumber: derived.turnNumber,
  });

  const campaign = session.campaign;
  const expectedDirectiveHash = campaignDirectiveHash({
    version: campaign.directiveVersion,
    publicCharter: campaign.publicCharter as Record<string, unknown>,
    gmDirective: campaign.gmDirective as Record<string, unknown>,
  });
  if (expectedDirectiveHash !== campaign.directiveHash) {
    throw new Error("Campaign directive integrity check failed");
  }
  const { gmDirective, ...publicCampaign } = campaign;
  return json({
    session: { ...session, campaign: publicCampaign },
    derived,
    assignment,
    campaignDirective: {
      version: campaign.directiveVersion,
      hash: campaign.directiveHash,
      publicCharter: campaign.publicCharter,
      ...(agent.role === "gm" ? { gmDirective } : {}),
    },
    contentPolicy: CONTENT_POLICY,
  });
}
