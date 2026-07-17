import assert from "node:assert/strict";
import test from "node:test";
import { applyEffect, parseCharacterSheet, parseStoredCharacterSheet, rollCheck } from "../src/server/rpg-rules.ts";
import { nextTurn, orderedTurnActors } from "../src/server/turns.ts";
import { parseActionBody } from "../src/server/action-schema.ts";
import { deriveSession } from "../src/server/events.ts";

function actor() {
  return {
    agentId: "2",
    name: "Veyra",
    attributes: { might: 2, agility: 1, wits: 2, spirit: 1 },
    maxVitality: 12,
    maxFocus: 4,
    vitality: 12,
    focus: 4,
    conditions: [],
    inventory: ["rope"],
  };
}

test("character sheets enforce a six-point original core and derive resources", () => {
  const sheet = parseCharacterSheet({ attributes: { might: 2, agility: 1, wits: 2, spirit: 1 }, inventory: ["iron lantern"] });
  assert.equal(sheet.maxVitality, 12);
  assert.equal(sheet.maxFocus, 4);
  assert.throws(() => parseCharacterSheet({ attributes: { might: 3, agility: 3, wits: 3, spirit: 3 } }));
});

test("stored character sheets revalidate attributes while recomputing derived resources", () => {
  const sheet = parseStoredCharacterSheet({
    attributes: { might: 2, agility: 1, wits: 1, spirit: 2 },
    inventory: ["lantern"],
    maxVitality: 999,
    maxFocus: 999,
  });

  assert.equal(sheet.maxVitality, 12);
  assert.equal(sheet.maxFocus, 5);
});

test("recorded d20 checks are deterministic under an injected roller and honor criticals", () => {
  assert.deepEqual(rollCheck({ attribute: "wits", difficulty: 13 }, actor(), () => 11), {
    die: "d20", roll: 11, attribute: "wits", modifier: 2, total: 13, difficulty: 13, outcome: "success", critical: null,
  });
  assert.equal(rollCheck({ attribute: "might", difficulty: 25 }, actor(), () => 20).outcome, "success");
  assert.equal(rollCheck({ attribute: "might", difficulty: 5 }, actor(), () => 1).outcome, "failure");
});

test("event effects clamp resources and update conditions, inventory, and clocks", () => {
  const actors = { "2": actor() };
  const clocks = {};
  applyEffect(actors, clocks, { type: "vitality", target: "actor", amount: -50 }, "2");
  applyEffect(actors, clocks, { type: "condition", target: "actor", mode: "add", value: "staggered" }, "2");
  applyEffect(actors, clocks, { type: "inventory", target: "actor", mode: "add", value: "glass key" }, "2");
  applyEffect(actors, clocks, { type: "clock", key: "gate collapse", amount: 4 }, "2");
  assert.equal(actors["2"].vitality, 0);
  assert.deepEqual(actors["2"].conditions, ["staggered"]);
  assert.deepEqual(actors["2"].inventory, ["rope", "glass key"]);
  assert.equal(clocks["gate collapse"], 4);
});

test("turn order is GM then players and round increments only when it wraps", () => {
  const order = orderedTurnActors([{ id: 9n, role: "player" }, { id: 4n, role: "gm" }, { id: 7n, role: "player" }]);
  assert.deepEqual(order.map((item) => item.id), [4n, 7n, 9n]);
  assert.deepEqual(nextTurn(order, 4n, 1), { actor: { id: 7n, role: "player" }, roundNumber: 1, wrapped: false, phase: "awaiting_intent" });
  assert.deepEqual(nextTurn(order, 9n, 1), { actor: { id: 4n, role: "gm" }, roundNumber: 2, wrapped: true, phase: "awaiting_adjudication" });
});

test("GM checks require both outcome narrations and parse branch effects", () => {
  const parsed = parseActionBody({
    kind: "adjudicate",
    adjudication: {
      check: { attribute: "agility", difficulty: 13 },
      successNarration: "Veyra clears the falling stones.",
      failureNarration: "The stones catch Veyra across the shoulder.",
      failureEffects: [{ type: "vitality", target: "actor", amount: -3 }],
    },
  });
  assert.equal(parsed.kind, "adjudicate");
  assert.equal(parsed.adjudication.check.difficulty, 13);
  assert.equal(parsed.adjudication.failureEffects[0].amount, -3);
  assert.throws(() => parseActionBody({ kind: "adjudicate", adjudication: { check: { attribute: "wits", difficulty: 10 } } }));
});

test("event replay reconstructs phases, resources, conditions, and clocks", () => {
  const initial = actor();
  const state = deriveSession([
    { type: "SESSION_STARTED", payload: {} },
    { type: "ACTOR_INITIALIZED", payload: { actor: initial } },
    { type: "ROUND_STARTED", payload: { roundNumber: 2 } },
    { type: "TURN_ADVANCED", payload: { turnNumber: 5, roundNumber: 2, agentId: "2", phase: "awaiting_intent", startedAtMs: 100 } },
    { type: "ACTION_SUBMITTED", payload: { actingAgentId: "2", submittedAtMs: 200 } },
    { type: "STATE_CHANGED", payload: { actingAgentId: "2", effect: { type: "vitality", target: "actor", amount: -4 } } },
    { type: "STATE_CHANGED", payload: { actingAgentId: "2", effect: { type: "condition", target: "actor", mode: "add", value: "burned" } } },
    { type: "STATE_CHANGED", payload: { actingAgentId: "2", effect: { type: "clock", key: "tower alarm", amount: 3 } } },
  ]);
  assert.equal(state.status, "active");
  assert.equal(state.roundNumber, 2);
  assert.equal(state.turnNumber, 5);
  assert.equal(state.phase, "awaiting_adjudication");
  assert.equal(state.pendingActorAgentId, 2n);
  assert.equal(state.actors["2"].vitality, 8);
  assert.deepEqual(state.actors["2"].conditions, ["burned"]);
  assert.equal(state.clocks["tower alarm"], 3);
});

test("event replay removes reset actors from canonical state", () => {
  const state = deriveSession([
    { type: "SESSION_STARTED", payload: {} },
    { type: "ACTOR_INITIALIZED", payload: { actor: { agentId: "5", name: "Nyx", attributes: { might: 1, agility: 1, wits: 1, spirit: 1 }, maxVitality: 10, maxFocus: 4, inventory: [], vitality: 10, focus: 4, conditions: [] } } },
    { type: "ACTOR_REMOVED", payload: { agentId: "5", reason: "account_reset" } },
  ]);

  assert.equal(state.actors["5"], undefined);
});
