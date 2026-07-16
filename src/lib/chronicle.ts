export type AgentRef = {
  id: string;
  name: string;
  role: "gm" | "player" | "observer";
  character: { name: string } | null;
};

export type StreamEvent = {
  sequence: string;
  type: string;
  payload: unknown;
  agentId: string | null;
  agent?: AgentRef | null;
  createdAt: string;
};

export type ChronicleBeat = {
  event: StreamEvent;
  eyebrow: string;
  title: string;
  body: string;
  tone: "system" | "turn" | "action" | "gm";
};

export type Turn = {
  turnNumber: number;
  agentName: string | null;
  startedAtMs: number | null;
  beats: ChronicleBeat[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringAt(value: unknown, path: string[]): string | null {
  let current: unknown = value;
  for (const key of path) current = asRecord(current)[key];
  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function numberAt(value: unknown, path: string[]): number | null {
  let current: unknown = value;
  for (const key of path) current = asRecord(current)[key];
  return typeof current === "number" ? current : null;
}

function actorName(event: StreamEvent) {
  if (event.agent?.character?.name) return event.agent.character.name;
  if (event.agent?.name) return event.agent.name;
  if (event.agentId) return `Agent ${event.agentId}`;
  return "The table";
}

export function beatFromEvent(event: StreamEvent): ChronicleBeat {
  const payload = asRecord(event.payload);

  if (event.type === "SESSION_STARTED") {
    return {
      event,
      eyebrow: "Session opened",
      title: "The campaign begins",
      body: "The table is live and the agents have entered the scene.",
      tone: "system",
    };
  }

  if (event.type === "TURN_ADVANCED") {
    const turnNumber = numberAt(payload, ["turnNumber"]);
    const name = actorName(event);
    return {
      event,
      eyebrow: "New turn",
      title: turnNumber ? `Turn ${turnNumber}: ${name}` : `${name} takes the turn`,
      body: "The spotlight shifts and the next agent is expected to act.",
      tone: "turn",
    };
  }

  if (event.type === "ACTION_SUBMITTED") {
    const action =
      stringAt(payload, ["intent", "say"]) ??
      stringAt(payload, ["intent", "action"]) ??
      stringAt(payload, ["intent", "do"]) ??
      stringAt(payload, ["say"]) ??
      stringAt(payload, ["action"]) ??
      stringAt(payload, ["message"]);

    return {
      event,
      eyebrow: `${actorName(event)} acts`,
      title: "Declaration",
      body: action ?? "An action was submitted, but it did not include spectator-facing text.",
      tone: "action",
    };
  }

  if (event.type === "GM_ADJUDICATED") {
    const result =
      stringAt(payload, ["adjudication", "result"]) ??
      stringAt(payload, ["adjudication", "say"]) ??
      stringAt(payload, ["result"]) ??
      stringAt(payload, ["message"]);

    return {
      event,
      eyebrow: "GM ruling",
      title: "What happens next",
      body: result ?? "The GM resolved the action, but no visible ruling text was provided.",
      tone: "gm",
    };
  }

  return {
    event,
    eyebrow: event.type.replaceAll("_", " ").toLowerCase(),
    title: "Table update",
    body: "A campaign event was recorded.",
    tone: "system",
  };
}

export function buildTurns(events: StreamEvent[]) {
  const turns: Turn[] = [];
  let current: Turn | null = null;

  for (const event of events) {
    const beat = beatFromEvent(event);

    if (event.type === "TURN_ADVANCED") {
      const payload = asRecord(event.payload);
      const turnNumber = numberAt(payload, ["turnNumber"]) ?? turns.length + 1;
      current = {
        turnNumber,
        agentName: actorName(event),
        startedAtMs: numberAt(payload, ["startedAtMs"]),
        beats: [beat],
      };
      turns.push(current);
      continue;
    }

    if (!current) {
      current = { turnNumber: 0, agentName: null, startedAtMs: null, beats: [] };
      turns.push(current);
    }
    current.beats.push(beat);
  }

  return turns;
}
