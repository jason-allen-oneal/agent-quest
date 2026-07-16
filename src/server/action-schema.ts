type TextMap = Record<string, string>;

function strictTextMap(value: unknown, allowed: Set<string>, label: string): TextMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Response(`${label} must be an object`, { status: 400 });
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([key, item]) => !allowed.has(key) || typeof item !== "string" || !item.trim() || item.length > 1200)) {
    throw new Response(`${label} contains unknown, empty, non-text, or oversized fields`, { status: 400 });
  }
  if (entries.reduce((sum, [, item]) => sum + (item as string).length, 0) > 3000) throw new Response(`${label} is too large`, { status: 400 });
  return Object.fromEntries(entries.map(([key, item]) => [key, (item as string).trim()]));
}

export function parseActionBody(body: Record<string, unknown>):
  | { kind: "intent"; intent: TextMap }
  | { kind: "adjudicate"; adjudication: TextMap } {
  const kind = body.kind;
  if (kind === "intent") {
    if (Object.keys(body).some((key) => key !== "kind" && key !== "intent")) throw new Response("Unknown action fields", { status: 400 });
    return { kind, intent: strictTextMap(body.intent, new Set(["say", "action", "do", "target", "notes"]), "intent") };
  }
  if (kind === "adjudicate") {
    if (Object.keys(body).some((key) => key !== "kind" && key !== "adjudication")) throw new Response("Unknown adjudication fields", { status: 400 });
    return { kind, adjudication: strictTextMap(body.adjudication, new Set(["result", "say", "narration", "outcome", "notes"]), "adjudication") };
  }
  throw new Response("kind must be intent|adjudicate", { status: 400 });
}

export function authorizeAction(input: {
  role: "gm" | "player" | "observer";
  sessionStatus: "created" | "active" | "paused" | "stopped";
  kind: "intent" | "adjudicate";
  actorId: bigint;
  currentTurnAgentId: bigint | null;
}): { allowed: true } | { allowed: false; status: 403 | 409; message: string } {
  if (input.sessionStatus !== "active") return { allowed: false, status: 409, message: "Actions are allowed only while the session is active" };
  if (input.role === "observer") return { allowed: false, status: 403, message: "Observer accounts are read-only" };
  if (input.kind === "adjudicate") return input.role === "gm" ? { allowed: true } : { allowed: false, status: 403, message: "GM role required for adjudication" };
  if (input.role !== "player") return { allowed: false, status: 403, message: "Only players may submit action intent" };
  if (input.currentTurnAgentId !== input.actorId) return { allowed: false, status: 409, message: "It is not this player's turn" };
  return { allowed: true };
}
