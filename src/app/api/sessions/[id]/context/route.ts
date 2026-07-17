import { NextRequest } from "next/server";
import { requireAgentForCampaign } from "@/server/auth";
import { prisma } from "@/server/db";
import { replaySession } from "@/server/events";
import { json } from "@/server/http";
import { CONTENT_POLICY } from "@/server/content-policy";

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

  const assignment = derived.status !== "active" || derived.currentTurnAgentId !== agent.id
    ? { kind: "wait", reason: derived.status !== "active" ? `session_${derived.status}` : "not_your_turn" }
    : agent.role === "gm" && derived.phase === "awaiting_adjudication"
      ? {
          kind: derived.turnNumber === 1 && derived.pendingActorAgentId === agent.id ? "frame_opening_scene" : "adjudicate",
          method: "POST",
          path: `/api/sessions/${sessionId}/action`,
          requiresIdempotencyKey: true,
        }
      : agent.role === "player" && derived.phase === "awaiting_intent"
        ? { kind: "submit_intent", method: "POST", path: `/api/sessions/${sessionId}/action`, requiresIdempotencyKey: true }
        : { kind: "wait", reason: "role_phase_mismatch" };

  return json({ session, derived, assignment, contentPolicy: CONTENT_POLICY });
}
