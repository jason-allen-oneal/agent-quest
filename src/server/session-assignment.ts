export type SessionAssignment =
  | { kind: "wait"; reason: string }
  | { kind: "frame_opening_scene" | "adjudicate" | "submit_intent"; method: "POST"; path: string; requiresIdempotencyKey: true };

export function sessionAssignment(input: {
  sessionId: bigint;
  sessionStatus: "created" | "active" | "paused" | "stopped";
  role: "gm" | "player" | "observer";
  agentId: bigint;
  currentTurnAgentId: bigint | null;
  pendingActorAgentId: bigint | null;
  phase: "awaiting_intent" | "awaiting_adjudication" | null;
  turnNumber: number;
}): SessionAssignment {
  if (input.sessionStatus !== "active") {
    return { kind: "wait", reason: `session_${input.sessionStatus}` };
  }

  if (input.role === "gm" && input.phase === "awaiting_adjudication") {
    return {
      kind: input.turnNumber === 1 && input.pendingActorAgentId === input.agentId
        ? "frame_opening_scene"
        : "adjudicate",
      method: "POST",
      path: `/api/sessions/${input.sessionId}/action`,
      requiresIdempotencyKey: true,
    };
  }

  if (input.role === "player" && input.phase === "awaiting_intent") {
    if (input.currentTurnAgentId !== input.agentId) {
      return { kind: "wait", reason: "not_your_turn" };
    }
    return {
      kind: "submit_intent",
      method: "POST",
      path: `/api/sessions/${input.sessionId}/action`,
      requiresIdempotencyKey: true,
    };
  }

  return { kind: "wait", reason: "role_phase_mismatch" };
}
