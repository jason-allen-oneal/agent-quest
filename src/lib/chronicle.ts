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
  roundNumber: number | null;
  agentName: string | null;
  startedAtMs: number | null;
  beats: ChronicleBeat[];
};

const CHRONICLE_EVENT_TYPES = new Set([
  "SESSION_STARTED",
  "ACTOR_INITIALIZED",
  "ROUND_STARTED",
  "TURN_ADVANCED",
  "CHECK_ROLLED",
  "STATE_CHANGED",
  "TURN_SKIPPED",
  "ACTION_SUBMITTED",
  "GM_ADJUDICATED",
]);

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

  if (event.type === "ACTOR_INITIALIZED") {
    const name = actorName(event);
    return {
      event,
      eyebrow: "The party assembles",
      title: `${name} enters the story`,
      body: "An adventurer is ready at the table.",
      tone: "system",
    };
  }

  if (event.type === "TURN_ADVANCED") {
    const turnNumber = numberAt(payload, ["turnNumber"]);
    const roundNumber = numberAt(payload, ["roundNumber"]);
    const name = actorName(event);
    return {
      event,
      eyebrow: "New turn",
      title: turnNumber ? `Turn ${turnNumber}: ${name}` : `${name} takes the turn`,
      body: roundNumber ? `Round ${roundNumber}. The spotlight shifts and the next agent is expected to act.` : "The spotlight shifts and the next agent is expected to act.",
      tone: "turn",
    };
  }

  if (event.type === "ROUND_STARTED") {
    const roundNumber = numberAt(payload, ["roundNumber"]);
    return { event, eyebrow: "New round", title: roundNumber ? `Round ${roundNumber} begins` : "A new round begins", body: "The Game Master frames the changed scene before the adventurers act again.", tone: "turn" };
  }

  if (event.type === "CHECK_ROLLED") {
    const roll = numberAt(payload, ["roll"]);
    const modifier = numberAt(payload, ["modifier"]);
    const total = numberAt(payload, ["total"]);
    const difficulty = numberAt(payload, ["difficulty"]);
    const attribute = stringAt(payload, ["attribute"]);
    const outcome = stringAt(payload, ["outcome"]);
    const critical = stringAt(payload, ["critical"]);
    const detail = roll != null && total != null && difficulty != null
      ? `d20 ${roll}${modifier != null ? ` + ${modifier}` : ""} = ${total} against ${difficulty}`
      : "A recorded check was resolved.";
    return {
      event,
      eyebrow: critical ? `Critical ${critical}` : "Fate check",
      title: `${attribute ? `${attribute[0]!.toUpperCase()}${attribute.slice(1)}: ` : ""}${outcome ?? "resolved"}`,
      body: detail,
      tone: "action",
    };
  }

  if (event.type === "STATE_CHANGED") {
    const effect = asRecord(payload.effect);
    const type = stringAt(effect, ["type"]);
    const amount = numberAt(effect, ["amount"]);
    const value = stringAt(effect, ["value"]) ?? stringAt(effect, ["key"]);
    return {
      event,
      eyebrow: "World state",
      title: type ? `${type[0]!.toUpperCase()}${type.slice(1)} changed` : "The consequences take hold",
      body: value ?? (amount != null ? `Change: ${amount > 0 ? "+" : ""}${amount}` : "The canonical campaign state changed."),
      tone: "system",
    };
  }

  if (event.type === "TURN_SKIPPED") {
    const reason = stringAt(payload, ["reason"]);
    return { event, eyebrow: "Turn expired", title: "The story moves on", body: reason === "adjudication_timeout" ? "The Game Master did not resolve the pending action before the deadline." : "The active adventurer did not act before the deadline.", tone: "system" };
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

function joinNames(names: string[]) {
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function compareSequence(left: StreamEvent, right: StreamEvent) {
  try {
    const a = BigInt(left.sequence);
    const b = BigInt(right.sequence);
    return a < b ? -1 : a > b ? 1 : 0;
  } catch {
    return left.sequence.localeCompare(right.sequence, undefined, { numeric: true });
  }
}

/**
 * Convert the append-only event log into the public chronicle. Internal events
 * stay in the audit stream; spectators see only meaningful story beats.
 */
export function buildChronicleBeats(events: StreamEvent[]): ChronicleBeat[] {
  const ordered = [...events].sort(compareSequence);
  const beats: ChronicleBeat[] = [];

  for (let index = 0; index < ordered.length; index += 1) {
    const event = ordered[index]!;
    if (!CHRONICLE_EVENT_TYPES.has(event.type)) continue;

    if (event.type === "ACTOR_INITIALIZED") {
      const actors = [actorName(event)];
      while (ordered[index + 1]?.type === "ACTOR_INITIALIZED") {
        index += 1;
        actors.push(actorName(ordered[index]!));
      }
      const names = joinNames(actors);
      beats.push({
        event,
        eyebrow: "The party assembles",
        title: actors.length === 1 ? `${names} enters the story` : "Adventurers enter the story",
        body: `${names} ${actors.length === 1 ? "is" : "are"} ready at the table.`,
        tone: "system",
      });
      continue;
    }

    beats.push(beatFromEvent(event));
  }

  return beats;
}

export function buildTurns(events: StreamEvent[]) {
  const turns: Turn[] = [];
  let current: Turn | null = null;

  for (const beat of buildChronicleBeats(events)) {
    const event = beat.event;

    if (event.type === "TURN_ADVANCED") {
      const payload = asRecord(event.payload);
      const turnNumber = numberAt(payload, ["turnNumber"]) ?? turns.length + 1;
      current = {
        turnNumber,
        roundNumber: numberAt(payload, ["roundNumber"]),
        agentName: actorName(event),
        startedAtMs: numberAt(payload, ["startedAtMs"]),
        beats: [beat],
      };
      turns.push(current);
      continue;
    }

    if (!current) {
      current = { turnNumber: 0, roundNumber: null, agentName: null, startedAtMs: null, beats: [] };
      turns.push(current);
    }
    current.beats.push(beat);
  }

  return turns;
}
