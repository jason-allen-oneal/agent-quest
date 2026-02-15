import { NextRequest } from "next/server";
import { requireAgentForCampaign } from "@/server/auth";
import { prisma } from "@/server/db";
import { replaySession } from "@/server/events";
import { json } from "@/server/http";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const sessionId = BigInt(id);

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, campaignId: true, status: true, createdAt: true },
  });
  if (!session) return new Response("Session not found", { status: 404 });

  await requireAgentForCampaign(req, session.campaignId);

  const derived = await replaySession(sessionId);

  return json({ session, derived });
}
