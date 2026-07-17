import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAutoStartReadiness } from "../src/server/session-start.ts";
import { deriveSession } from "../src/server/events.ts";

const gm = { id: 1n, role: "gm", characterId: null };
const readyPlayer = (id) => ({ id, role: "player", characterId: id + 100n });
const unreadyPlayer = (id) => ({ id, role: "player", characterId: null });

test("auto-start waits for the minimum player count and every character", () => {
  assert.equal(evaluateAutoStartReadiness({}, [gm, readyPlayer(2n)]).reason, "waiting_for_players");
  assert.equal(evaluateAutoStartReadiness({}, [gm, readyPlayer(2n), unreadyPlayer(3n)]).reason, "waiting_for_characters");
  const ready = evaluateAutoStartReadiness({}, [gm, readyPlayer(2n), readyPlayer(3n)]);
  assert.equal(ready.ready, true);
  assert.equal(ready.minimumPlayers, 2);
  assert.equal(ready.maximumPlayers, 6);
});

test("campaign settings can disable auto-start or choose a minimum", () => {
  assert.equal(evaluateAutoStartReadiness({ autoStart: false }, [gm, readyPlayer(2n), readyPlayer(3n)]).reason, "disabled");
  assert.equal(evaluateAutoStartReadiness({ minPlayers: 1, maxPlayers: 4 }, [gm, readyPlayer(2n)]).ready, true);
  assert.equal(evaluateAutoStartReadiness({ minPlayers: 3 }, [gm, readyPlayer(2n), readyPlayer(3n)]).reason, "waiting_for_players");
});

test("character replacement updates the canonical actor snapshot", () => {
  const state = deriveSession([
    { type: "ACTOR_INITIALIZED", payload: { actor: { agentId: "2", name: "Placeholder", attributes: { might: 1, agility: 1, wits: 1, spirit: 1 }, maxVitality: 10, maxFocus: 4, inventory: [], vitality: 10, focus: 4, conditions: [] } } },
    { type: "CHARACTER_REPLACED", payload: { actor: { agentId: "2", name: "Barnacle Boy", attributes: { might: 2, agility: 1, wits: 2, spirit: 1 }, maxVitality: 12, maxFocus: 4, inventory: ["lantern"], vitality: 12, focus: 4, conditions: [] } } },
  ]);
  assert.equal(state.actors["2"].name, "Barnacle Boy");
  assert.deepEqual(state.actors["2"].attributes, { might: 2, agility: 1, wits: 2, spirit: 1 });
  assert.deepEqual(state.actors["2"].inventory, ["lantern"]);
});
