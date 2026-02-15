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

  await prisma.session.update({ where: { id: sessionId }, data: { status: "paused" } });

  await appendEvent({
    campaignId: session.campaignId,
    sessionId,
    agentId: agent.id,
    type: "SESSION_PAUSED",
    payload: { pausedAtMs: Date.now() },
  });

  return json({ ok: true });
}
