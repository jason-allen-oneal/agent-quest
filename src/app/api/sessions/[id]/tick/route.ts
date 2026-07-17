import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { requireAgentForCampaign } from "@/server/auth";
import { appendEvents, replaySession, type AppendEventInput } from "@/server/events";
import { json } from "@/server/http";
import { nextTurn, orderedTurnActors, type TurnActor } from "@/server/turns";
import { parsePositiveBigInt } from "@/server/ids";

const TURN_TIMEOUT_MS = Number(process.env.TURN_TIMEOUT_MS ?? 120_000);

async function getTurnOrder(campaignId: bigint): Promise<TurnActor[]> {
  const agents = await prisma.agent.findMany({
    where: { campaignId, role: { in: ["gm", "player"] } },
    orderBy: [{ role: "asc" }, { id: "asc" }], // gm (alphabetically) then players; stable
    select: { id: true, role: true },
  });
  return orderedTurnActors(agents.map((a) => ({ id: a.id, role: a.role as "gm" | "player" })));
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const sessionId = parsePositiveBigInt(id);
  if (sessionId === null) return json({ error: "Invalid session id" }, { status: 400 });
  const requestId = req.headers.get("x-request-id") ?? undefined;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, campaignId: true, status: true },
  });
  if (!session) return new Response("Session not found", { status: 404 });

  const agent = await requireAgentForCampaign(req, session.campaignId);
  if (agent.role !== "gm") return new Response("GM role required", { status: 403 });
  const derived = await replaySession(sessionId);
  if (derived.status !== "active") return json({ ok: true, skipped: "not_active" });
  if (!derived.turnStartedAtMs || !derived.currentTurnAgentId) {
    return json({ ok: true, skipped: "no_turn" });
  }

  const expired = Date.now() - derived.turnStartedAtMs > TURN_TIMEOUT_MS;
  if (!expired) return json({ ok: true, expired: false });

  const order = await getTurnOrder(session.campaignId);
  if (!order.length) return json({ ok: true, skipped: "no_agents" });

  const next = nextTurn(order, derived.currentTurnAgentId, derived.roundNumber);
  const now = Date.now();
  const events: AppendEventInput[] = [{
    campaignId: session.campaignId,
    sessionId,
    agentId: agent.id,
    idempotencyKey: `tick-turn-${derived.turnNumber}`,
    type: "TURN_SKIPPED",
    payload: {
      turnNumber: derived.turnNumber,
      roundNumber: derived.roundNumber,
      agentId: derived.currentTurnAgentId.toString(),
      phase: derived.phase,
      skippedAtMs: now,
      reason: derived.phase === "awaiting_adjudication" ? "adjudication_timeout" : "intent_timeout",
    },
  }];
  if (next.wrapped) events.push({ campaignId: session.campaignId, sessionId, agentId: agent.id, type: "ROUND_STARTED", payload: { roundNumber: next.roundNumber, startedAtMs: now } });
  events.push({
    campaignId: session.campaignId,
    sessionId,
    agentId: next.actor.id,
    type: "TURN_ADVANCED",
    payload: {
      turnNumber: derived.turnNumber + 1,
      roundNumber: next.roundNumber,
      agentId: next.actor.id.toString(),
      phase: next.phase,
      startedAtMs: now,
      reason: "timeout",
    },
  });
  for (const event of events) event.requestId = requestId;
  const appended = await appendEvents(events);

  return json({ ok: true, expired: true, events: appended, nextTurn: { agentId: next.actor.id, roundNumber: next.roundNumber, phase: next.phase } });
}
