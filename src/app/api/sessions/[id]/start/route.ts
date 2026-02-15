import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { requireAgentForCampaign } from "@/server/auth";
import { appendEvent } from "@/server/events";
import { json } from "@/server/http";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const sessionId = BigInt(id);

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, campaignId: true, status: true },
  });
  if (!session) return new Response("Session not found", { status: 404 });

  const agent = await requireAgentForCampaign(req, session.campaignId);
  if (agent.role !== "gm") return new Response("GM role required", { status: 403 });

  if (session.status === "active") return json({ ok: true, session });

  // Mark status (cache) + append canonical event.
  await prisma.session.update({
    where: { id: sessionId },
    data: { status: "active", startedAt: new Date() },
  });

  await appendEvent({
    campaignId: session.campaignId,
    sessionId,
    agentId: agent.id,
    type: "SESSION_STARTED",
    payload: { startedAtMs: Date.now() },
  });

  // Initialize the first turn to GM.
  await appendEvent({
    campaignId: session.campaignId,
    sessionId,
    agentId: agent.id,
    type: "TURN_ADVANCED",
    payload: { turnNumber: 1, agentId: agent.id.toString(), startedAtMs: Date.now() },
  });

  return json({ ok: true });
}
