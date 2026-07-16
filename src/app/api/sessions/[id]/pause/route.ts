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
  if (session.status === "paused") return json({ ok: true, idempotent: true });
  if (session.status !== "active") return new Response("Only an active session can be paused", { status: 409 });

  const transitioned = await prisma.session.updateMany({ where: { id: sessionId, status: "active" }, data: { status: "paused" } });
  if (transitioned.count !== 1) return json({ ok: true, idempotent: true });

  await appendEvent({
    campaignId: session.campaignId,
    sessionId,
    agentId: agent.id,
    idempotencyKey: `session-paused-${Date.now()}`,
    type: "SESSION_PAUSED",
    payload: { pausedAtMs: Date.now() },
  });

  return json({ ok: true });
}
