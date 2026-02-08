import { prisma } from "./db";
import type { Prisma } from "@prisma/client";

export type EventType =
  | "CAMPAIGN_CREATED"
  | "CAMPAIGN_ARCHIVED"
  | "SESSION_CREATED"
  | "SESSION_STARTED"
  | "SESSION_PAUSED"
  | "SESSION_STOPPED"
  | "AGENT_REGISTERED"
  | "TURN_ADVANCED"
  | "ACTION_SUBMITTED"
  | "GM_ADJUDICATED";

export type AppendEventInput = {
  campaignId: bigint;
  sessionId: bigint;
  agentId?: bigint | null;
  type: EventType;
  payload: unknown;
};

export async function appendEvent(input: AppendEventInput) {
  // Allocate the next per-session sequence number atomically.
  // This avoids races when multiple writers append concurrently.
  return await prisma.$transaction(async (tx) => {
    // Ensure sequence row exists.
    await tx.sessionSequence.upsert({
      where: { sessionId: input.sessionId },
      create: { sessionId: input.sessionId, nextSequence: 1n },
      update: {},
    });

    // Increment and read back.
    const seqRow = await tx.sessionSequence.update({
      where: { sessionId: input.sessionId },
      data: { nextSequence: { increment: 1n } },
      select: { nextSequence: true },
    });

    const sequence = seqRow.nextSequence - 1n;

    return await tx.event.create({
      data: {
        campaignId: input.campaignId,
        sessionId: input.sessionId,
        agentId: input.agentId ?? null,
        type: input.type,
        payload: input.payload as Prisma.InputJsonValue,
        sequence,
      },
    });
  });
}

export type SessionDerived = {
  status: "created" | "active" | "paused" | "stopped";
  currentTurnAgentId: bigint | null;
  turnNumber: number;
  turnStartedAtMs: number | null;
};

export async function replaySession(sessionId: bigint): Promise<SessionDerived> {
  const events = await prisma.event.findMany({
    where: { sessionId },
    orderBy: [{ sequence: "asc" }],
    select: { type: true, payload: true },
  });

  const state: SessionDerived = {
    status: "created",
    currentTurnAgentId: null,
    turnNumber: 0,
    turnStartedAtMs: null,
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
        break;
      case "TURN_ADVANCED": {
        const p = e.payload as Record<string, unknown> | null;
        const turnNumber = typeof p?.turnNumber === "number" ? p.turnNumber : state.turnNumber + 1;
        const agentIdRaw = p?.agentId;
        const startedAtMs = typeof p?.startedAtMs === "number" ? p.startedAtMs : Date.now();

        state.turnNumber = Number(turnNumber);
        state.currentTurnAgentId =
          typeof agentIdRaw === "string" || typeof agentIdRaw === "number"
            ? BigInt(agentIdRaw)
            : null;
        state.turnStartedAtMs = startedAtMs;
        break;
      }
      default:
        break;
    }
  }

  return state;
}
