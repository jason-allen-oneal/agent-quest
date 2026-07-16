import { NextRequest } from "next/server";
import { requireAgentForCampaign } from "@/server/auth";
import { prisma } from "@/server/db";
import { appendEvent, replaySession } from "@/server/events";
import { json } from "@/server/http";
import { authorizeAction, parseActionBody } from "@/server/action-schema";
import { enforceContentLength, readJsonObject, requireIdempotencyKey } from "@/server/request";
import { rateLimitMany } from "@/server/rate-limit";
import { sha256Hex } from "@/server/crypto";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const tooLarge = enforceContentLength(req, 8192);
    if (tooLarge) return tooLarge;
    const { id } = await ctx.params;
    let sessionId: bigint;
    try { sessionId = BigInt(id); } catch { return new Response("Invalid session id", { status: 400 }); }
    const idempotencyKey = requireIdempotencyKey(req);
    const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { campaignId: true, status: true } });
    if (!session) return new Response("Session not found", { status: 404 });
    const agent = await requireAgentForCampaign(req, session.campaignId);
    const limited = await rateLimitMany(req, [
      { id: "action-global", scope: "global", limit: 300, windowMs: 60_000 },
      { id: "action-account", scope: "subject", discriminator: String(agent.accountId), limit: 20, windowMs: 60_000 },
    ]);
    if (limited) return limited;
    const action = parseActionBody(await readJsonObject(req, 8192));
    const idempotencyHash = sha256Hex(JSON.stringify(action));
    const state = await replaySession(sessionId);
    const authorization = authorizeAction({ role: agent.role, sessionStatus: state.status, kind: action.kind, actorId: agent.id, currentTurnAgentId: state.currentTurnAgentId });
    if (!authorization.allowed) return new Response(authorization.message, { status: authorization.status });

    if (action.kind === "intent") {
      const event = await appendEvent({ campaignId: session.campaignId, sessionId, agentId: agent.id, idempotencyKey, idempotencyHash, type: "ACTION_SUBMITTED", payload: { kind: "intent", intent: action.intent, submittedAtMs: Date.now() } });
      return json({ ok: true, event }, { status: 201 });
    }

    const event = await appendEvent({ campaignId: session.campaignId, sessionId, agentId: agent.id, idempotencyKey, idempotencyHash, type: "GM_ADJUDICATED", payload: { adjudication: action.adjudication, adjudicatedAtMs: Date.now() } });
    return json({ ok: true, event }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}
