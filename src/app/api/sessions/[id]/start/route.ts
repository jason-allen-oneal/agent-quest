import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { requireAgentForCampaign } from "@/server/auth";
import { json } from "@/server/http";
import { startSession } from "@/server/session-start";
import { parsePositiveBigInt } from "@/server/ids";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionId = parsePositiveBigInt(id);
    if (sessionId === null) return json({ error: "Invalid session id" }, { status: 400 });
    const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { campaignId: true } });
    if (!session) return new Response("Session not found", { status: 404 });
    const agent = await requireAgentForCampaign(req, session.campaignId);
    if (agent.role !== "gm") return new Response("GM role required", { status: 403 });
    return json(await startSession(sessionId, agent.id, req.headers.get("x-request-id") ?? undefined));
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}
