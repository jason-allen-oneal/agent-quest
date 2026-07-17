import { NextRequest } from "next/server";
import { requireAgentForCampaign } from "@/server/auth";
import { prisma } from "@/server/db";
import { appendEvent, appendEvents, replaySession, type AppendEventInput } from "@/server/events";
import { json } from "@/server/http";
import { authorizeAction, parseActionBody } from "@/server/action-schema";
import { enforceContentLength, readJsonObject, requireIdempotencyKey } from "@/server/request";
import { rateLimitMany } from "@/server/rate-limit";
import { sha256Hex } from "@/server/crypto";
import { rollCheck } from "@/server/rpg-rules";
import { nextTurn, orderedTurnActors } from "@/server/turns";
import { parsePositiveBigInt } from "@/server/ids";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const tooLarge = enforceContentLength(req, 8192);
    if (tooLarge) return tooLarge;
    const { id } = await ctx.params;
    const sessionId = parsePositiveBigInt(id);
    if (sessionId === null) return json({ error: "Invalid session id" }, { status: 400 });
    const requestId = req.headers.get("x-request-id") ?? undefined;
    const clientIdempotencyKey = requireIdempotencyKey(req);
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
    const authorization = authorizeAction({ role: agent.role, sessionStatus: state.status, kind: action.kind, actorId: agent.id, currentTurnAgentId: state.currentTurnAgentId, phase: state.phase });
    if (!authorization.allowed) return new Response(authorization.message, { status: authorization.status });

    if (action.kind === "intent") {
      const event = await appendEvent({
        campaignId: session.campaignId,
        sessionId,
        agentId: agent.id,
        idempotencyKey: `turn-${state.turnNumber}-intent`,
        idempotencyHash,
        type: "ACTION_SUBMITTED",
        payload: { kind: "intent", intent: action.intent, actingAgentId: agent.id.toString(), submittedAtMs: Date.now(), clientIdempotencyKey },
        requestId,
      });
      return json({ ok: true, event, phase: "awaiting_adjudication", gmActionRequired: true }, { status: 201 });
    }

    if (!state.currentTurnAgentId) return new Response("No active turn", { status: 409 });
    const members = await prisma.agent.findMany({
      where: { campaignId: session.campaignId, role: { in: ["gm", "player"] } },
      select: { id: true, role: true },
    });
    const order = orderedTurnActors(members.map((member) => ({ id: member.id, role: member.role as "gm" | "player" })));
    const memberIds = new Set(order.map((member) => member.id.toString()));
    const actingAgentId = (state.pendingActorAgentId ?? state.currentTurnAgentId).toString();
    const actor = state.actors[actingAgentId];
    if (action.adjudication.check && !actor) return new Response("Checks require a player character actor", { status: 409 });

    const checkResult = action.adjudication.check && actor ? rollCheck(action.adjudication.check, actor) : null;
    const branchEffects = checkResult?.outcome === "success"
      ? action.adjudication.successEffects
      : checkResult?.outcome === "failure"
        ? action.adjudication.failureEffects
        : [];
    const effects = [...action.adjudication.effects, ...branchEffects];
    for (const effect of effects) {
      if (effect.type !== "clock") {
        const target = effect.target === "actor" ? actingAgentId : effect.target;
        if (!memberIds.has(target)) return new Response(`Effect target ${target} is not a campaign actor`, { status: 400 });
        if (!state.actors[target]) return new Response(`Effect target ${target} has no initialized character state`, { status: 400 });
      }
    }

    const ordinaryNarration = action.adjudication.text.result
      ?? action.adjudication.text.narration
      ?? action.adjudication.text.say
      ?? action.adjudication.text.outcome
      ?? null;
    const narration = checkResult?.outcome === "success"
      ? action.adjudication.successNarration
      : checkResult?.outcome === "failure"
        ? action.adjudication.failureNarration
        : ordinaryNarration;
    const now = Date.now();
    const next = nextTurn(order, state.currentTurnAgentId, state.roundNumber);
    const events: AppendEventInput[] = [];
    if (checkResult) {
      events.push({ campaignId: session.campaignId, sessionId, agentId: agent.id, type: "CHECK_ROLLED", payload: { actingAgentId, ...checkResult, rolledAtMs: now } });
    }
    for (const effect of effects) {
      events.push({ campaignId: session.campaignId, sessionId, agentId: agent.id, type: "STATE_CHANGED", payload: { actingAgentId, effect, changedAtMs: now } });
    }
    events.push({
      campaignId: session.campaignId,
      sessionId,
      agentId: agent.id,
      idempotencyKey: `turn-${state.turnNumber}-adjudication`,
      idempotencyHash,
      type: "GM_ADJUDICATED",
      payload: {
        adjudication: {
          ...action.adjudication.text,
          result: narration ?? "The Game Master updates the state of the world.",
          namedElements: action.adjudication.namedElements,
        },
        actingAgentId,
        resolution: checkResult,
        appliedEffects: effects,
        adjudicatedAtMs: now,
        clientIdempotencyKey,
      },
    });
    if (next.wrapped) {
      events.push({ campaignId: session.campaignId, sessionId, agentId: agent.id, type: "ROUND_STARTED", payload: { roundNumber: next.roundNumber, startedAtMs: now } });
    }
    events.push({
      campaignId: session.campaignId,
      sessionId,
      agentId: next.actor.id,
      type: "TURN_ADVANCED",
      payload: {
        turnNumber: state.turnNumber + 1,
        roundNumber: next.roundNumber,
        agentId: next.actor.id.toString(),
        phase: next.phase,
        startedAtMs: now,
        reason: "adjudicated",
      },
    });
    for (const event of events) event.requestId = requestId;
    const appended = await appendEvents(events);
    return json({ ok: true, events: appended, resolution: checkResult, effects, nextTurn: { agentId: next.actor.id, roundNumber: next.roundNumber, phase: next.phase } }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}
