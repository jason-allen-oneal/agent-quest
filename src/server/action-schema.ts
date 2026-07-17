import { assertContentPolicy } from "./content-policy.ts";
import { parseCheck, parseEffects, type CheckRequest, type RpgEffect } from "./rpg-rules.ts";

type TextMap = Record<string, string>;

export type Adjudication = {
  text: TextMap;
  check: CheckRequest | null;
  successNarration: string | null;
  failureNarration: string | null;
  effects: RpgEffect[];
  successEffects: RpgEffect[];
  failureEffects: RpgEffect[];
};

function strictTextMap(value: unknown, allowed: Set<string>, label: string): TextMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Response(`${label} must be an object`, { status: 400 });
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([key, item]) => !allowed.has(key) || typeof item !== "string" || !item.trim() || item.length > 1200)) {
    throw new Response(`${label} contains unknown, empty, non-text, or oversized fields`, { status: 400 });
  }
  if (entries.reduce((sum, [, item]) => sum + (item as string).length, 0) > 3000) throw new Response(`${label} is too large`, { status: 400 });
  const result = Object.fromEntries(entries.map(([key, item]) => [key, (item as string).trim()]));
  for (const text of Object.values(result)) assertContentPolicy(text, label);
  return result;
}

export function parseActionBody(body: Record<string, unknown>):
  | { kind: "intent"; intent: TextMap }
  | { kind: "adjudicate"; adjudication: Adjudication } {
  const kind = body.kind;
  if (kind === "intent") {
    if (Object.keys(body).some((key) => key !== "kind" && key !== "intent")) throw new Response("Unknown action fields", { status: 400 });
    return { kind, intent: strictTextMap(body.intent, new Set(["say", "action", "do", "target", "notes"]), "intent") };
  }
  if (kind === "adjudicate") {
    if (Object.keys(body).some((key) => key !== "kind" && key !== "adjudication")) throw new Response("Unknown adjudication fields", { status: 400 });
    if (!body.adjudication || typeof body.adjudication !== "object" || Array.isArray(body.adjudication)) throw new Response("adjudication must be an object", { status: 400 });
    const input = body.adjudication as Record<string, unknown>;
    const textKeys = new Set(["result", "say", "narration", "outcome", "notes"]);
    const structuredKeys = new Set(["check", "successNarration", "failureNarration", "effects", "successEffects", "failureEffects"]);
    if (Object.keys(input).some((key) => !textKeys.has(key) && !structuredKeys.has(key))) throw new Response("Unknown adjudication fields", { status: 400 });
    const rawText = Object.fromEntries(Object.entries(input).filter(([key]) => textKeys.has(key)));
    const text = Object.keys(rawText).length ? strictTextMap(rawText, textKeys, "adjudication") : {};
    const optionalNarration = (key: "successNarration" | "failureNarration") => {
      if (input[key] == null) return null;
      const value = String(input[key]).trim();
      if (!value || value.length > 1200) throw new Response(`${key} must be 1-1200 characters`, { status: 400 });
      assertContentPolicy(value, key);
      return value;
    };
    const adjudication: Adjudication = {
      text,
      check: parseCheck(input.check),
      successNarration: optionalNarration("successNarration"),
      failureNarration: optionalNarration("failureNarration"),
      effects: parseEffects(input.effects, "effects"),
      successEffects: parseEffects(input.successEffects, "successEffects"),
      failureEffects: parseEffects(input.failureEffects, "failureEffects"),
    };
    if (!Object.keys(text).length && !adjudication.check && !adjudication.effects.length) throw new Response("adjudication must include narration, a check, or effects", { status: 400 });
    if (adjudication.check && (!adjudication.successNarration || !adjudication.failureNarration)) {
      throw new Response("checks require successNarration and failureNarration", { status: 400 });
    }
    return { kind, adjudication };
  }
  throw new Response("kind must be intent|adjudicate", { status: 400 });
}

export function authorizeAction(input: {
  role: "gm" | "player" | "observer";
  sessionStatus: "created" | "active" | "paused" | "stopped";
  kind: "intent" | "adjudicate";
  actorId: bigint;
  currentTurnAgentId: bigint | null;
  phase?: "awaiting_intent" | "awaiting_adjudication" | null;
}): { allowed: true } | { allowed: false; status: 403 | 409; message: string } {
  if (input.sessionStatus !== "active") return { allowed: false, status: 409, message: "Actions are allowed only while the session is active" };
  if (input.role === "observer") return { allowed: false, status: 403, message: "Observer accounts are read-only" };
  if (input.kind === "adjudicate") {
    if (input.role !== "gm") return { allowed: false, status: 403, message: "GM role required for adjudication" };
    return input.phase === "awaiting_adjudication" ? { allowed: true } : { allowed: false, status: 409, message: "The session is not awaiting GM adjudication" };
  }
  if (input.role !== "player") return { allowed: false, status: 403, message: "Only players may submit action intent" };
  if (input.phase !== "awaiting_intent") return { allowed: false, status: 409, message: "This turn already has an action awaiting adjudication" };
  if (input.currentTurnAgentId !== input.actorId) return { allowed: false, status: 409, message: "It is not this player's turn" };
  return { allowed: true };
}
