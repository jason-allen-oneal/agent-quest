import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { authorizeAction, parseActionBody } from "../src/server/action-schema.ts";
import { consumeApiKeyClaim } from "../src/server/claims.ts";
import { issueRegistrationChallenge, parseRegistration, planStartedCharacterUpsert, verifyRegistrationChallenge } from "../src/server/onboarding.ts";
import { getClientIp } from "../src/server/rate-limit.ts";
import { acquireStreamSlot } from "../src/server/session-stream.ts";
import { autoJoinActiveCampaigns } from "../src/server/campaign-membership.ts";
import { CONTENT_POLICY, findContentPolicyViolation } from "../src/server/content-policy.ts";
import { parseCampaignCreateBody } from "../src/server/campaign-schema.ts";
import { jsonErrorResponse } from "../src/server/http.ts";
import { readJsonObjectOrResponse } from "../src/server/request.ts";
import { sessionAssignment } from "../src/server/session-assignment.ts";

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

test("started campaign recovery can initialize a manually restored empty player seat", () => {
  assert.equal(planStartedCharacterUpsert({ role: "player", sessionStatus: "active", characterId: null, actorInitialized: false }), "create");
  assert.equal(planStartedCharacterUpsert({ role: "player", sessionStatus: "active", characterId: 12n, actorInitialized: true }), "replace");
  assert.throws(
    () => planStartedCharacterUpsert({ role: "player", sessionStatus: "active", characterId: 12n, actorInitialized: false }),
    (error) => error instanceof Response && error.status === 409,
  );
});

test("action schema rejects arbitrary nested JSON and oversized text", () => {
  assert.deepEqual(parseActionBody({ kind: "intent", intent: { say: "I listen." } }), { kind: "intent", intent: { say: "I listen." } });
  assert.throws(() => parseActionBody({ kind: "intent", intent: { payload: { nested: true } } }));
  assert.throws(() => parseActionBody({ kind: "adjudicate", adjudication: { result: "x".repeat(1201) } }));
});

test("content policy blocks explicit copying and named-creator imitation without blocking genres", () => {
  assert.match(findContentPolicyViolation("Copy the full text of the novel verbatim."), /copying/);
  assert.match(findContentPolicyViolation("Write this in the exact style of Famous Writer."), /style imitation/);
  assert.equal(findContentPolicyViolation("Run an original gothic horror mystery with tragic heroes."), null);
  assert.match(findContentPolicyViolation("Barnacle Boy", "identifier"), /third-party|similar/);
  assert.equal(findContentPolicyViolation("Barnacle Boy", "player-name"), null);
  assert.throws(
    () => parseActionBody({ kind: "adjudicate", adjudication: { narration: "Reproduce the screenplay verbatim." } }),
    (error) => error instanceof Response && error.status === 422,
  );
  assert.match(CONTENT_POLICY.rejectionInstruction, /Rephrase it into wholly original/);
});

test("campaign creation requires a rights attestation and pins the server content policy", () => {
  assert.throws(
    () => parseCampaignCreateBody({ name: "Ashen Vale" }),
    (error) => error instanceof Response && error.status === 400,
  );
  const campaign = parseCampaignCreateBody({
    name: "Ashen Vale",
    description: "A drowned observatory calls to anyone willing to enter its dreaming machinery.",
    minPlayers: 2,
    maxPlayers: 5,
    rightsAttested: true,
    rightsBasis: "original",
    ipScreening: {
      checkedAt: new Date().toISOString(),
      queries: ["Ashen Vale", "Ashen Vale trademark", '"Ashen Vale" game OR novel'],
      sources: [
        { kind: "uspto-federal", query: "Ashen Vale", reference: "https://www.uspto.gov/trademarks/search", result: "no-obvious-conflict" },
        { kind: "web-search", query: '"Ashen Vale" game OR novel', reference: "https://www.google.com/search?q=%22Ashen%20Vale%22+game+OR+novel", result: "no-obvious-conflict" },
      ],
      notes: "Current exact and similar-name searches found no obvious conflict in the recorded sources.",
    },
    settings: { genre: "gothic fantasy" },
  });
  assert.equal(campaign.data.settings.contentPolicy.version, "original-or-authorized-v2");
  assert.equal(campaign.data.settings.contentPolicy.rightsAttested, true);
  assert.equal(campaign.data.minPlayers, 2);
  assert.equal(campaign.data.maxPlayers, 5);
  assert.throws(() => parseCampaignCreateBody({
    name: "Broken Roster",
    description: "An original campaign description long enough to pass validation.",
    minPlayers: 5,
    maxPlayers: 2,
    rightsAttested: true,
  }));
  assert.throws(() => parseCampaignCreateBody({
    name: "Copied Crypt",
    description: "An original campaign description long enough to pass validation.",
    rightsAttested: true,
    settings: { premise: "Copy the full text of the novel verbatim." },
  }));
});

test("IP screening validation errors are returned as JSON", async () => {
  let thrown;
  try {
    parseCampaignCreateBody({
      name: "Broken Screening",
      description: "An original campaign description long enough to pass validation.",
      rightsAttested: true,
      rightsBasis: "original",
      ipScreening: { checkedAt: "not-a-timestamp" },
    });
    assert.fail("expected IP screening validation to fail");
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof Response);
  const response = await jsonErrorResponse(thrown);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(await response.json(), { error: "ipScreening.checkedAt must be an ISO timestamp" });
});

test("JSON error wrapping preserves status and retry headers", async () => {
  const response = await jsonErrorResponse(new Response("IP screening is temporarily unavailable", {
    status: 429,
    headers: { "retry-after": "30", "x-request-id": "req-1" },
  }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(response.headers.get("retry-after"), "30");
  assert.equal(response.headers.get("x-request-id"), "req-1");
  assert.deepEqual(await response.json(), { error: "IP screening is temporarily unavailable" });
});

test("invalid JSON and oversized request bodies become JSON errors", async () => {
  const invalidJson = await readJsonObjectOrResponse(new Request("https://agent-quest.test/api/campaigns", {
    method: "POST",
    body: "{not-json",
  }), 1024);
  assert.ok(invalidJson instanceof Response);
  const invalidJsonResponse = await jsonErrorResponse(invalidJson);
  assert.equal(invalidJsonResponse.status, 400);
  assert.deepEqual(await invalidJsonResponse.json(), { error: "Request body must be valid JSON" });

  const oversized = await readJsonObjectOrResponse(new Request("https://agent-quest.test/api/campaigns", {
    method: "POST",
    body: JSON.stringify({ name: "x".repeat(200) }),
  }), 32);
  assert.ok(oversized instanceof Response);
  const oversizedResponse = await jsonErrorResponse(oversized);
  assert.equal(oversizedResponse.status, 413);
  assert.deepEqual(await oversizedResponse.json(), { error: "Request body too large" });
});

test("session action authorization keeps observers read-only and enforces turn/state", () => {
  assert.equal(authorizeAction({ role: "observer", sessionStatus: "active", kind: "intent", actorId: 1n, currentTurnAgentId: 1n, phase: "awaiting_intent" }).allowed, false);
  assert.equal(authorizeAction({ role: "player", sessionStatus: "paused", kind: "intent", actorId: 1n, currentTurnAgentId: 1n, phase: "awaiting_intent" }).allowed, false);
  assert.equal(authorizeAction({ role: "player", sessionStatus: "active", kind: "intent", actorId: 1n, currentTurnAgentId: 2n, phase: "awaiting_intent" }).allowed, false);
  assert.equal(authorizeAction({ role: "player", sessionStatus: "active", kind: "adjudicate", actorId: 1n, currentTurnAgentId: 1n, phase: "awaiting_adjudication" }).allowed, false);
  assert.equal(authorizeAction({ role: "gm", sessionStatus: "active", kind: "intent", actorId: 1n, currentTurnAgentId: 1n, phase: "awaiting_intent" }).allowed, false);
  assert.equal(authorizeAction({ role: "gm", sessionStatus: "active", kind: "adjudicate", actorId: 1n, currentTurnAgentId: 2n, phase: "awaiting_adjudication" }).allowed, true);
  assert.equal(authorizeAction({ role: "gm", sessionStatus: "active", kind: "adjudicate", actorId: 1n, currentTurnAgentId: 2n, phase: "awaiting_intent" }).allowed, false);
  assert.equal(authorizeAction({ role: "player", sessionStatus: "active", kind: "intent", actorId: 1n, currentTurnAgentId: 1n, phase: "awaiting_intent" }).allowed, true);
  assert.equal(authorizeAction({ role: "player", sessionStatus: "active", kind: "intent", actorId: 1n, currentTurnAgentId: 1n, phase: "awaiting_adjudication" }).allowed, false);
});

test("session context assigns the GM after a player submits intent", () => {
  const adjudicate = sessionAssignment({
    sessionId: 4n,
    sessionStatus: "active",
    role: "gm",
    agentId: 6n,
    currentTurnAgentId: 7n,
    pendingActorAgentId: 7n,
    phase: "awaiting_adjudication",
    turnNumber: 2,
  });
  assert.equal(adjudicate.kind, "adjudicate");

  const player = sessionAssignment({
    sessionId: 4n,
    sessionStatus: "active",
    role: "player",
    agentId: 7n,
    currentTurnAgentId: 7n,
    pendingActorAgentId: 7n,
    phase: "awaiting_adjudication",
    turnNumber: 2,
  });
  assert.deepEqual(player, { kind: "wait", reason: "role_phase_mismatch" });
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

test("approved players auto-join eligible active campaigns idempotently", async () => {
  const campaigns = [
    { id: 1n, name: "Open Table", description: "Open", minPlayers: 2, maxPlayers: 4, settings: {} },
    { id: 2n, name: "Tagged Table", description: "Tagged", minPlayers: 2, maxPlayers: 4, settings: { requiredTags: ["d20"] } },
    { id: 3n, name: "Closed Table", description: "Closed", minPlayers: 2, maxPlayers: 4, settings: { autoJoinPlayers: false } },
  ];
  const memberships = new Map();
  let campaignWhere;
  let nextAgent = 10n;
  const tx = {
    campaign: { async findMany(args) { campaignWhere = args.where; return campaigns; } },
    agent: {
      async findUnique({ where }) { return memberships.get(`${where.accountId_campaignId.accountId}:${where.accountId_campaignId.campaignId}`) ?? null; },
      async count() { return 0; },
      async create({ data }) {
        const agent = { id: nextAgent++ };
        memberships.set(`${data.accountId}:${data.campaignId}`, agent);
        return agent;
      },
    },
  };
  const first = await autoJoinActiveCampaigns(tx, { accountId: 7n, name: "Nyx", tags: ["player", "d20"] });
  const second = await autoJoinActiveCampaigns(tx, { accountId: 7n, name: "Nyx", tags: ["player", "d20"] });
  assert.deepEqual(first.map((item) => item.id), [1n, 2n]);
  assert.deepEqual(second.map((item) => item.id), [1n, 2n]);
  assert.equal(memberships.size, 2);
  assert.deepEqual(campaignWhere.sessions, { some: { status: "created" } });
});
