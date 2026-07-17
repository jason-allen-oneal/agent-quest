import crypto from "node:crypto";
import { assertContentPolicy } from "./content-policy.ts";

export const ATTRIBUTE_NAMES = ["might", "agility", "wits", "spirit"] as const;
export type AttributeName = (typeof ATTRIBUTE_NAMES)[number];
export type Attributes = Record<AttributeName, number>;

export type CharacterSheet = {
  attributes: Attributes;
  maxVitality: number;
  maxFocus: number;
  inventory: string[];
};

export type ActorState = CharacterSheet & {
  agentId: string;
  name: string;
  vitality: number;
  focus: number;
  conditions: string[];
};

export type RpgEffect =
  | { type: "vitality" | "focus"; target: "actor" | string; amount: number }
  | { type: "condition"; target: "actor" | string; mode: "add" | "remove"; value: string }
  | { type: "inventory"; target: "actor" | string; mode: "add" | "remove"; value: string }
  | { type: "clock"; key: string; amount: number };

export type CheckRequest = {
  attribute: AttributeName;
  difficulty: number;
};

export const DIFFICULTY_GUIDE = Object.freeze({ routine: 7, risky: 10, hard: 13, severe: 16, legendary: 19 });

function integer(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Response(`${label} must be an integer from ${min} to ${max}`, { status: 400 });
  }
  return Number(value);
}

export function parseCharacterSheet(value: unknown): CharacterSheet {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  if (Object.keys(input).some((key) => !["attributes", "inventory"].includes(key))) {
    throw new Response("sheet contains unknown fields", { status: 400 });
  }
  const rawAttributes = input.attributes && typeof input.attributes === "object" && !Array.isArray(input.attributes)
    ? input.attributes as Record<string, unknown>
    : {};
  if (Object.keys(rawAttributes).some((key) => !ATTRIBUTE_NAMES.includes(key as AttributeName))) {
    throw new Response("attributes contain unknown fields", { status: 400 });
  }
  const attributes = Object.fromEntries(ATTRIBUTE_NAMES.map((name) => [name, integer(rawAttributes[name] ?? 1, `attributes.${name}`, 0, 3)])) as Attributes;
  const pointTotal = Object.values(attributes).reduce((sum, score) => sum + score, 0);
  if (pointTotal > 6) throw new Response("attribute point total must not exceed 6", { status: 400 });

  if (input.inventory != null && !Array.isArray(input.inventory)) throw new Response("inventory must be an array", { status: 400 });
  const inventory = (Array.isArray(input.inventory) ? input.inventory : []).map((item) => String(item).trim());
  if (inventory.length > 8 || inventory.some((item) => !item || item.length > 80)) {
    throw new Response("inventory must contain at most 8 non-empty items of 80 characters", { status: 400 });
  }
  for (const item of inventory) assertContentPolicy(item, "inventory item");

  return {
    attributes,
    maxVitality: 8 + attributes.might * 2,
    maxFocus: 3 + attributes.spirit,
    inventory,
  };
}

export function parseCheck(value: unknown): CheckRequest | null {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Response("check must be an object", { status: 400 });
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["attribute", "difficulty"].includes(key))) throw new Response("check contains unknown fields", { status: 400 });
  const attribute = String(input.attribute ?? "") as AttributeName;
  if (!ATTRIBUTE_NAMES.includes(attribute)) throw new Response(`check.attribute must be ${ATTRIBUTE_NAMES.join("|")}`, { status: 400 });
  return { attribute, difficulty: integer(input.difficulty, "check.difficulty", 5, 25) };
}

export function parseEffects(value: unknown, label: string): RpgEffect[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 12) throw new Response(`${label} must be an array of at most 12 effects`, { status: 400 });
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Response(`${label}[${index}] must be an object`, { status: 400 });
    const effect = raw as Record<string, unknown>;
    const type = String(effect.type ?? "");
    if (type === "vitality" || type === "focus") {
      if (Object.keys(effect).some((key) => !["type", "target", "amount"].includes(key))) throw new Response(`${label}[${index}] contains unknown fields`, { status: 400 });
      const target = String(effect.target ?? "actor");
      if (target !== "actor" && !/^\d+$/.test(target)) throw new Response(`${label}[${index}].target must be actor or an agent id`, { status: 400 });
      return { type, target, amount: integer(effect.amount, `${label}[${index}].amount`, -20, 20) };
    }
    if (type === "condition" || type === "inventory") {
      if (Object.keys(effect).some((key) => !["type", "target", "mode", "value"].includes(key))) throw new Response(`${label}[${index}] contains unknown fields`, { status: 400 });
      const target = String(effect.target ?? "actor");
      const mode = String(effect.mode ?? "");
      const text = String(effect.value ?? "").trim();
      if (target !== "actor" && !/^\d+$/.test(target)) throw new Response(`${label}[${index}].target must be actor or an agent id`, { status: 400 });
      if (mode !== "add" && mode !== "remove") throw new Response(`${label}[${index}].mode must be add|remove`, { status: 400 });
      if (!text || text.length > 80) throw new Response(`${label}[${index}].value must be 1-80 characters`, { status: 400 });
      assertContentPolicy(text, `${label}[${index}].value`);
      return { type, target, mode, value: text } as RpgEffect;
    }
    if (type === "clock") {
      if (Object.keys(effect).some((key) => !["type", "key", "amount"].includes(key))) throw new Response(`${label}[${index}] contains unknown fields`, { status: 400 });
      const key = String(effect.key ?? "").trim();
      if (!/^[A-Za-z0-9 _-]{1,60}$/.test(key)) throw new Response(`${label}[${index}].key must be 1-60 safe characters`, { status: 400 });
      return { type, key, amount: integer(effect.amount, `${label}[${index}].amount`, -12, 12) };
    }
    throw new Response(`${label}[${index}].type is invalid`, { status: 400 });
  });
}

export function rollCheck(check: CheckRequest, actor: ActorState, randomInt: (min: number, max: number) => number = crypto.randomInt) {
  const die = randomInt(1, 21);
  const modifier = actor.attributes[check.attribute];
  const total = die + modifier;
  const outcome = die === 20 ? "success" as const : die === 1 ? "failure" as const : total >= check.difficulty ? "success" as const : "failure" as const;
  return {
    die: "d20",
    roll: die,
    attribute: check.attribute,
    modifier,
    total,
    difficulty: check.difficulty,
    outcome,
    critical: die === 20 ? "triumph" as const : die === 1 ? "disaster" as const : null,
  };
}

export function applyEffect(actors: Record<string, ActorState>, clocks: Record<string, number>, effect: RpgEffect, actingAgentId: string): void {
  if (effect.type === "clock") {
    clocks[effect.key] = Math.max(0, Math.min(12, (clocks[effect.key] ?? 0) + effect.amount));
    return;
  }
  const targetId = effect.target === "actor" ? actingAgentId : effect.target;
  const target = actors[targetId];
  if (!target) return;
  if (effect.type === "vitality") target.vitality = Math.max(0, Math.min(target.maxVitality, target.vitality + effect.amount));
  if (effect.type === "focus") target.focus = Math.max(0, Math.min(target.maxFocus, target.focus + effect.amount));
  if (effect.type === "condition") {
    const set = new Set(target.conditions);
    if (effect.mode === "add") set.add(effect.value); else set.delete(effect.value);
    target.conditions = [...set];
  }
  if (effect.type === "inventory") {
    if (effect.mode === "add" && target.inventory.length < 20 && !target.inventory.includes(effect.value)) target.inventory.push(effect.value);
    if (effect.mode === "remove") target.inventory = target.inventory.filter((item) => item !== effect.value);
  }
}
