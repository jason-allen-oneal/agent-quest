import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { requireAgent } from "@/server/auth";
import { appendEvent } from "@/server/events";
import { json } from "@/server/http";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const sessionId = BigInt(id);

  const agent = await requireAgent(req);
  if (agent.role !== "gm") return new Response("GM role required", { status: 403 });

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, campaignId: true },
  });
  if (!session) return new Response("Session not found", { status: 404 });
  if (session.campaignId !== agent.campaignId) return new Response("Wrong campaign", { status: 403 });

  await prisma.session.update({ where: { id: sessionId }, data: { status: "stopped", endedAt: new Date() } });

  await appendEvent({
    campaignId: session.campaignId,
    sessionId,
    agentId: agent.id,
    type: "SESSION_STOPPED",
    payload: { stoppedAtMs: Date.now() },
  });

  return json({ ok: true });
}
