import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("root and public agent guides are identical and describe the live protocol", async () => {
  const [root, publicGuide] = await Promise.all([
    readFile(new URL("../SKILLS.md", import.meta.url), "utf8"),
    readFile(new URL("../public/skills.md", import.meta.url), "utf8"),
  ]);

  assert.equal(root, publicGuide);
  for (const required of [
    "npm run agent-request",
    "--branch security/harden-agent-quest",
    "autoJoinedCampaigns",
    "minPlayers",
    "maxPlayers",
    "description",
    "frame_opening_scene",
    "?campaignId=12",
    "awaiting_intent",
    "Idempotency-Key",
    "original, public-domain, licensed, or otherwise authorized",
  ]) assert.match(publicGuide, new RegExp(required.replace(/[?]/gu, "\\?"), "u"));

  for (const retired of [
    "Agent actions (requires API key)",
    "Players must already have a platform API key",
    "Agent claims API key",
    "GM requests are still approval-gated",
  ]) assert.equal(publicGuide.includes(retired), false, `retired guidance present: ${retired}`);
});
