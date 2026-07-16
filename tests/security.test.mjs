import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { authorizeAction, parseActionBody } from "../src/server/action-schema.ts";
import { consumeApiKeyClaim } from "../src/server/claims.ts";
import { issueRegistrationChallenge, parseRegistration, verifyRegistrationChallenge } from "../src/server/onboarding.ts";
import { getClientIp } from "../src/server/rate-limit.ts";
import { acquireStreamSlot } from "../src/server/session-stream.ts";

test("registration proof binds the complete payload and expires", () => {
  process.env.AQ_ONBOARDING_CHALLENGE_SECRET = "test-only-secret-that-is-longer-than-thirty-two-characters";
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const reg = parseRegistration({ role: "player", name: "Lantern", botId: "lantern-sec-001", message: "hello", tags: ["player"], publicKey: publicKey.export({ format: "pem", type: "spki" }).toString() });
  const challenge = issueRegistrationChallenge(reg, 1_000_000);
  const signature = sign(null, Buffer.from(challenge.message), privateKey).toString("base64url");
  assert.equal(verifyRegistrationChallenge(reg, challenge.token, signature, 1_001_000), true);
  assert.equal(verifyRegistrationChallenge({ ...reg, role: "gm" }, challenge.token, signature, 1_001_000), false);
  assert.equal(verifyRegistrationChallenge(reg, challenge.token, signature, 1_400_001), false);
});

test("action schema rejects arbitrary nested JSON and oversized text", () => {
  assert.deepEqual(parseActionBody({ kind: "intent", intent: { say: "I listen." } }), { kind: "intent", intent: { say: "I listen." } });
  assert.throws(() => parseActionBody({ kind: "intent", intent: { payload: { nested: true } } }));
  assert.throws(() => parseActionBody({ kind: "adjudicate", adjudication: { result: "x".repeat(1201) } }));
});

test("session action authorization keeps observers read-only and enforces turn/state", () => {
  assert.equal(authorizeAction({ role: "observer", sessionStatus: "active", kind: "intent", actorId: 1n, currentTurnAgentId: 1n }).allowed, false);
  assert.equal(authorizeAction({ role: "player", sessionStatus: "paused", kind: "intent", actorId: 1n, currentTurnAgentId: 1n }).allowed, false);
  assert.equal(authorizeAction({ role: "player", sessionStatus: "active", kind: "intent", actorId: 1n, currentTurnAgentId: 2n }).allowed, false);
  assert.equal(authorizeAction({ role: "player", sessionStatus: "active", kind: "adjudicate", actorId: 1n, currentTurnAgentId: 1n }).allowed, false);
  assert.equal(authorizeAction({ role: "gm", sessionStatus: "active", kind: "intent", actorId: 1n, currentTurnAgentId: 1n }).allowed, false);
  assert.equal(authorizeAction({ role: "gm", sessionStatus: "active", kind: "adjudicate", actorId: 1n, currentTurnAgentId: 2n }).allowed, true);
  assert.equal(authorizeAction({ role: "player", sessionStatus: "active", kind: "intent", actorId: 1n, currentTurnAgentId: 1n }).allowed, true);
});

test("claim consumption issues exactly one key under concurrency", async () => {
  let unclaimed = true;
  const issued = [];
  const tx = {
    apiKeyClaim: { async updateMany() { if (!unclaimed) return { count: 0 }; unclaimed = false; return { count: 1 }; } },
    apiKey: { async create(args) { issued.push(args); } },
  };
  const attempts = await Promise.allSettled(Array.from({ length: 32 }, (_, index) => consumeApiKeyClaim(tx, { id: 1n, accountId: 2n }, new Date(), () => `test-key-${index}`)));
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(issued.length, 1);
});

test("client IP ignores spoofed forwarding headers unless the proxy is trusted", () => {
  const values = new Map([["x-forwarded-for", "attacker, proxy"], ["x-real-ip", "203.0.113.7"]]);
  const req = { headers: { get(name) { return values.get(name) ?? null; } } };
  delete process.env.AQ_TRUST_PROXY;
  assert.equal(getClientIp(req), "direct");
  process.env.AQ_TRUST_PROXY = "true";
  assert.equal(getClientIp(req), "203.0.113.7");
});

test("trusted proxy mode uses the proxy-overwritten client address", () => {
  const values = new Map([
    ["x-forwarded-for", "forged-client, proxy"],
    ["x-real-ip", "198.51.100.42"],
  ]);
  const req = { headers: { get(name) { return values.get(name) ?? null; } }, ip: "127.0.0.1" };
  process.env.AQ_TRUST_PROXY = "true";
  assert.equal(getClientIp(req), "198.51.100.42");
});

test("spectator stream slots fail closed when the shared lease store is unavailable", async () => {
  const slot = await acquireStreamSlot("198.51.100.4", 99n);
  assert.equal(slot, null);
});
