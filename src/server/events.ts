import { prisma } from "./db.ts";
import type { Prisma } from "@prisma/client";
import { applyEffect, type ActorState, type RpgEffect } from "./rpg-rules.ts";

export type EventType =
  | "CAMPAIGN_CREATED"
  | "CAMPAIGN_ARCHIVED"
  | "SESSION_CREATED"
  | "SESSION_STARTED"
  | "SESSION_PAUSED"
  | "SESSION_STOPPED"
  | "AGENT_REGISTERED"
  | "ACTOR_INITIALIZED"
  | "ACTOR_REMOVED"
  | "CHARACTER_REPLACED"
  | "ROUND_STARTED"
  | "TURN_ADVANCED"
  | "TURN_SKIPPED"
  | "ACTION_SUBMITTED"
  | "CHECK_ROLLED"
  | "STATE_CHANGED"
  | "GM_ADJUDICATED";

export type AppendEventInput = {
  campaignId: bigint;
  sessionId: bigint;
  agentId?: bigint | null;
  type: EventType;
  payload: unknown;
  idempotencyKey?: string;
  idempotencyHash?: string;
};

export async function appendEvent(input: AppendEventInput) {
  const events = await appendEvents([input]);
  return events[0]!;
}

export async function appendEvents(inputs: AppendEventInput[]) {
  if (!inputs.length) return [];
  const sessionId = inputs[0]!.sessionId;
  if (inputs.some((input) => input.sessionId !== sessionId)) throw new Error("Event batch must target one session");
  // Allocate the next per-session sequence number atomically.
  // This avoids races when multiple writers append concurrently.
  return await prisma.$transaction(async (tx) => {
    // Ensure sequence row exists.
    await tx.sessionSequence.upsert({
      where: { sessionId },
      create: { sessionId, nextSequence: 1n },
      update: {},
    });

    // Increment and read back.
    const seqRow = await tx.sessionSequence.update({
      where: { sessionId },
      data: { nextSequence: { increment: BigInt(inputs.length) } },
      select: { nextSequence: true },
    });

    const firstSequence = seqRow.nextSequence - BigInt(inputs.length);
    const created = [];
    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index]!;
      created.push(await tx.event.create({ data: {
        campaignId: input.campaignId,
        sessionId: input.sessionId,
        agentId: input.agentId ?? null,
        idempotencyKey: input.idempotencyKey,
        idempotencyHash: input.idempotencyHash,
        type: input.type,
        payload: input.payload as Prisma.InputJsonValue,
        sequence: firstSequence + BigInt(index),
      }}));
    }
    return created;
  }).catch(async (error: unknown) => {
    const idempotentInput = inputs.find((input) => input.idempotencyKey);
    if (idempotentInput && typeof error === "object" && error && "code" in error && error.code === "P2002") {
      const existing = await prisma.event.findFirst({ where: { sessionId, agentId: idempotentInput.agentId ?? null, idempotencyKey: idempotentInput.idempotencyKey } });
      if (existing && existing.type === idempotentInput.type && existing.idempotencyHash === (idempotentInput.idempotencyHash ?? null)) return [existing];
      if (existing) throw new Response("Idempotency-Key was already used with a different request", { status: 409 });
    }
    throw error;
  });
}

export type SessionDerived = {
  status: "created" | "active" | "paused" | "stopped";
  currentTurnAgentId: bigint | null;
  turnNumber: number;
  roundNumber: number;
  turnStartedAtMs: number | null;
  phase: "awaiting_intent" | "awaiting_adjudication" | null;
  pendingActorAgentId: bigint | null;
  actors: Record<string, ActorState>;
  clocks: Record<string, number>;
};

export function deriveSession(events: ReadonlyArray<{ type: string; payload: unknown }>): SessionDerived {
  const state: SessionDerived = {
    status: "created",
    currentTurnAgentId: null,
    turnNumber: 0,
    roundNumber: 0,
    turnStartedAtMs: null,
    phase: null,
    pendingActorAgentId: null,
    actors: {},
    clocks: {},
  };

  for (const e of events) {
    switch (e.type) {
      case "SESSION_STARTED":
        state.status = "active";
        break;
      case "SESSION_PAUSED":
        state.status = "paused";
        break;
      case "SESSION_STOPPED":
        state.status = "stopped";
        state.phase = null;
        break;
      case "ACTOR_INITIALIZED": {
        const p = e.payload as { actor?: ActorState } | null;
        if (p?.actor?.agentId) state.actors[p.actor.agentId] = structuredClone(p.actor);
        break;
      }
      case "ACTOR_REMOVED": {
        const p = e.payload as { agentId?: string | number } | null;
        if (typeof p?.agentId === "string" || typeof p?.agentId === "number") {
          delete state.actors[String(p.agentId)];
        }
        break;
      }
      case "CHARACTER_REPLACED": {
        const p = e.payload as { actor?: ActorState } | null;
        if (p?.actor?.agentId) state.actors[p.actor.agentId] = structuredClone(p.actor);
        break;
      }
      case "ROUND_STARTED": {
        const p = e.payload as Record<string, unknown> | null;
        state.roundNumber = typeof p?.roundNumber === "number" ? p.roundNumber : state.roundNumber + 1;
        break;
      }
      case "TURN_ADVANCED": {
        const p = e.payload as Record<string, unknown> | null;
        const turnNumber = typeof p?.turnNumber === "number" ? p.turnNumber : state.turnNumber + 1;
        const agentIdRaw = p?.agentId;
        const startedAtMs = typeof p?.startedAtMs === "number" ? p.startedAtMs : state.turnStartedAtMs;

        state.turnNumber = Number(turnNumber);
        if (typeof p?.roundNumber === "number") state.roundNumber = p.roundNumber;
        state.currentTurnAgentId =
          typeof agentIdRaw === "string" || typeof agentIdRaw === "number"
            ? BigInt(agentIdRaw)
            : null;
        state.turnStartedAtMs = startedAtMs;
        state.phase = p?.phase === "awaiting_adjudication" ? "awaiting_adjudication" : "awaiting_intent";
        state.pendingActorAgentId = state.phase === "awaiting_adjudication" ? state.currentTurnAgentId : null;
        break;
      }
      case "ACTION_SUBMITTED": {
        const p = e.payload as Record<string, unknown> | null;
        const actorIdRaw = p?.actingAgentId;
        state.pendingActorAgentId = typeof actorIdRaw === "string" || typeof actorIdRaw === "number"
          ? BigInt(actorIdRaw)
          : state.currentTurnAgentId;
        state.phase = "awaiting_adjudication";
        state.turnStartedAtMs = typeof p?.submittedAtMs === "number" ? p.submittedAtMs : state.turnStartedAtMs;
        break;
      }
      case "STATE_CHANGED": {
        const p = e.payload as { effect?: RpgEffect; actingAgentId?: string } | null;
        if (p?.effect && p.actingAgentId) applyEffect(state.actors, state.clocks, p.effect, p.actingAgentId);
        break;
      }
      default:
        break;
    }
  }

  return state;
}

export async function replaySession(sessionId: bigint): Promise<SessionDerived> {
  const events = await prisma.event.findMany({
    where: { sessionId },
    orderBy: [{ sequence: "asc" }],
    select: { type: true, payload: true },
  });
  return deriveSession(events);
}
