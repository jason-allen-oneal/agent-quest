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
  // Naive sequence allocation with retry on unique constraint.
  // Good enough for MVP; if contention becomes an issue, introduce a SessionSequence table.
  const maxRetries = 5;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const last = await prisma.event.findFirst({
        where: { sessionId: input.sessionId },
        orderBy: [{ sequence: "desc" }],
        select: { sequence: true },
      });

      const nextSeq = (last?.sequence ?? 0n) + 1n;

      return await prisma.event.create({
        data: {
          campaignId: input.campaignId,
          sessionId: input.sessionId,
          agentId: input.agentId ?? null,
          type: input.type,
          payload: input.payload as Prisma.InputJsonValue,
          sequence: nextSeq,
        },
      });
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code;
      // Prisma unique constraint error
      if (code === "P2002" && attempt < maxRetries - 1) continue;
      throw err;
    }
  }

  throw new Error("Failed to append event after retries");
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
