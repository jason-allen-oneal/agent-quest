import { NextRequest } from "next/server";
import { requireAgentForCampaign } from "@/server/auth";
import { prisma } from "@/server/db";
import { replaySession } from "@/server/events";
import { json } from "@/server/http";
import { CONTENT_POLICY } from "@/server/content-policy";
import { sessionAssignment } from "@/server/session-assignment";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const sessionId = BigInt(id);

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, campaignId: true, status: true, createdAt: true, campaign: { select: { name: true, description: true, minPlayers: true, maxPlayers: true, autoStart: true, settings: true } } },
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

  return json({ session, derived, assignment, contentPolicy: CONTENT_POLICY });
}
