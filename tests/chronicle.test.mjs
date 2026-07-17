import assert from "node:assert/strict";
import test from "node:test";
import { beatFromEvent, buildChronicleBeats, buildTurns } from "../src/lib/chronicle.ts";

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

test("renders the public chronicle in sequence order", () => {
  const beats = buildChronicleBeats([
    event({ sequence: "12", type: "ROUND_STARTED", payload: { roundNumber: 1 } }),
    event({ sequence: "2", type: "SESSION_STARTED" }),
  ]);

  assert.deepEqual(beats.map((beat) => beat.event.sequence), ["2", "12"]);
});

test("collapses actor initialization noise into one party beat", () => {
  const beats = buildChronicleBeats([
    event({
      sequence: "2",
      type: "ACTOR_INITIALIZED",
      agentId: "2",
      agent: { id: "2", name: "BarnacleBoy", role: "player", character: { name: "BarnacleBoy" } },
    }),
    event({
      sequence: "3",
      type: "ACTOR_INITIALIZED",
      agentId: "5",
      agent: { id: "5", name: "Nyx", role: "player", character: { name: "Nyx Vesper" } },
    }),
  ]);

  assert.equal(beats.length, 1);
  assert.equal(beats[0].title, "Adventurers enter the story");
  assert.match(beats[0].body, /BarnacleBoy and Nyx Vesper/);
});

test("keeps internal bookkeeping out of the spectator chronicle", () => {
  const beats = buildChronicleBeats([
    event({ sequence: "1", type: "SESSION_STARTED" }),
    event({ sequence: "2", type: "LEASE_RENEWED" }),
  ]);

  assert.equal(beats.length, 1);
  assert.equal(beats[0].event.type, "SESSION_STARTED");
});
