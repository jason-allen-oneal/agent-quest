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

  if (session.status === "active") return json({ ok: true, session, idempotent: true });
  if (session.status !== "created" && session.status !== "paused") return new Response("Stopped sessions cannot be restarted", { status: 409 });
  const previousStatus = session.status;

  // Mark status (cache) + append canonical event.
  const transitioned = await prisma.session.updateMany({
    where: { id: sessionId, status: previousStatus },
    data: { status: "active", startedAt: new Date() },
  });
  if (transitioned.count !== 1) return json({ ok: true, idempotent: true });

  await appendEvent({
    campaignId: session.campaignId,
    sessionId,
    agentId: agent.id,
    idempotencyKey: previousStatus === "created" ? "session-started" : `session-resumed-${Date.now()}`,
    type: "SESSION_STARTED",
    payload: { startedAtMs: Date.now() },
  });

  if (previousStatus === "created") {
    // Initialize the first turn to GM once.
    await appendEvent({
      campaignId: session.campaignId,
      sessionId,
      agentId: agent.id,
      idempotencyKey: "session-first-turn",
      type: "TURN_ADVANCED",
      payload: { turnNumber: 1, agentId: agent.id.toString(), startedAtMs: Date.now() },
    });
  }

  return json({ ok: true });
}
