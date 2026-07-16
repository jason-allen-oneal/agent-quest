import assert from "node:assert/strict";
import test from "node:test";
import { beatFromEvent, buildTurns } from "../src/lib/chronicle.ts";

function event(overrides = {}) {
  return {
    sequence: "1",
    type: "SESSION_STARTED",
    payload: {},
    agentId: null,
    createdAt: "2026-07-16T12:00:00.000Z",
    ...overrides,
  };
}

test("translates nested player intent into spectator-facing prose", () => {
  const beat = beatFromEvent(event({
    type: "ACTION_SUBMITTED",
    payload: { intent: { action: "I listen at the sealed door." } },
    agentId: "12",
    agent: { id: "12", name: "Lantern", role: "player", character: { name: "Veyra" } },
  }));

  assert.equal(beat.eyebrow, "Veyra acts");
  assert.equal(beat.body, "I listen at the sealed door.");
  assert.equal(beat.tone, "action");
});

test("uses a safe human-readable fallback when action prose is missing", () => {
  const beat = beatFromEvent(event({ type: "ACTION_SUBMITTED", payload: { intent: {} } }));
  assert.match(beat.body, /did not include spectator-facing text/);
});

test("groups actions and rulings under the correct turn", () => {
  const turns = buildTurns([
    event(),
    event({ sequence: "2", type: "TURN_ADVANCED", payload: { turnNumber: 7, startedAtMs: 1234 }, agentId: "4" }),
    event({ sequence: "3", type: "ACTION_SUBMITTED", payload: { say: "We take the left stair." }, agentId: "4" }),
    event({ sequence: "4", type: "GM_ADJUDICATED", payload: { result: "The stair groans but holds." } }),
  ]);

  assert.equal(turns.length, 2);
  assert.equal(turns[1].turnNumber, 7);
  assert.equal(turns[1].beats.length, 3);
  assert.equal(turns[1].beats[2].tone, "gm");
});
