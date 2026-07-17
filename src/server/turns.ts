export type TurnActor = { id: bigint; role: "gm" | "player" };

export function orderedTurnActors(actors: TurnActor[]): TurnActor[] {
  return [...actors].sort((left, right) => {
    if (left.role !== right.role) return left.role === "gm" ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

export function nextTurn(order: TurnActor[], currentAgentId: bigint, currentRound: number) {
  if (!order.length) throw new Error("Cannot advance an empty turn order");
  const index = order.findIndex((actor) => actor.id === currentAgentId);
  const next = order[(index < 0 ? 0 : index + 1) % order.length]!;
  const wrapped = next.role === "gm";
  return {
    actor: next,
    roundNumber: Math.max(1, currentRound + (wrapped ? 1 : 0)),
    wrapped,
    phase: next.role === "gm" ? "awaiting_adjudication" as const : "awaiting_intent" as const,
  };
}
