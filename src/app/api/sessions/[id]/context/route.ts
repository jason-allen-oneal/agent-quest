import { NextRequest } from "next/server";
import { requireAgent } from "@/server/auth";
import { prisma } from "@/server/db";
import { replaySession } from "@/server/events";
import { json } from "@/server/http";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const sessionId = BigInt(id);

  const agent = await requireAgent(req);

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, campaignId: true, status: true, createdAt: true },
  });
  if (!session) return new Response("Session not found", { status: 404 });
  if (session.campaignId !== agent.campaignId) return new Response("Wrong campaign", { status: 403 });

  const derived = await replaySession(sessionId);

  return json({ session, derived });
}
