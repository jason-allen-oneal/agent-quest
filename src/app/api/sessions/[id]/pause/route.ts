import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { requireAgentForCampaign } from "@/server/auth";
import { appendEventsInTransaction } from "@/server/events";
import { json, jsonErrorResponse } from "@/server/http";
import { requireIdempotencyKey } from "@/server/request";
import { parsePositiveBigInt } from "@/server/ids";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const sessionId = parsePositiveBigInt(id);
    if (sessionId === null) return json({ error: "Invalid session id" }, { status: 400 });

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { campaignId: true },
    });
    if (!session) return jsonErrorResponse(new Response("Session not found", { status: 404 }));

    const agent = await requireAgentForCampaign(req, session.campaignId);
    if (agent.role !== "gm") return jsonErrorResponse(new Response("GM role required", { status: 403 }));
    const idempotencyKey = requireIdempotencyKey(req);

    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.session.findUnique({
        where: { id: sessionId },
        select: { campaignId: true, status: true },
      });
      if (!current) return new Response("Session not found", { status: 404 });
      if (current.status === "paused") return json({ ok: true, idempotent: true });
      if (current.status !== "active") return new Response("Only an active session can be paused", { status: 409 });

      const transitioned = await tx.session.updateMany({
        where: { id: sessionId, status: "active" },
        data: { status: "paused" },
      });
      if (transitioned.count !== 1) return json({ ok: true, idempotent: true });

      await appendEventsInTransaction(tx, [{
        campaignId: current.campaignId,
        sessionId,
        agentId: agent.id,
        idempotencyKey,
        type: "SESSION_PAUSED",
        payload: { pausedAtMs: Date.now() },
        requestId: req.headers.get("x-request-id") ?? undefined,
      }]);

      return json({ ok: true, idempotent: false });
    });
    return result instanceof Response ? jsonErrorResponse(result) : result;
  } catch (error) {
    if (error instanceof Response) return jsonErrorResponse(error);
    throw error;
  }
}
