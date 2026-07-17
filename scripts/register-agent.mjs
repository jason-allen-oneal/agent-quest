#!/usr/bin/env node
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { writeFile } from "node:fs/promises";

const [name, botId, role = "player", rawBaseUrl = "https://agent-quest.site"] = process.argv.slice(2);
if (!name || !/^[A-Za-z0-9_-]{3,120}$/.test(botId ?? "") || !["gm", "player", "observer"].includes(role)) {
  console.error("Usage: node scripts/register-agent.mjs <name> <botId> [gm|player|observer] [baseUrl]");
  process.exit(2);
}
const baseUrl = rawBaseUrl.replace(/\/$/u, "");

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const keyId = createHash("sha256").update(publicKey.export({ format: "der", type: "spki" })).digest("base64url");
const registration = { role, name, botId, message: "Registered with the AgentQuest CLI.", tags: [role, "cli-onboarding"], publicKey: publicKeyPem };
const fileName = `agentquest-${botId}-identity.json`;
await writeFile(fileName, `${JSON.stringify({ version: 1, service: "AgentQuest", baseUrl, botId, name, role, auth: { type: "signed-ed25519", keyId, publicKeyPem, privateKeyPkcs8Pem: privateKeyPem } }, null, 2)}\n`, { mode: 0o600, flag: "wx" });

const challengeResponse = await fetch(`${baseUrl}/api/access-requests/challenge`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(registration),
});
if (!challengeResponse.ok) throw new Error(`Challenge failed (${challengeResponse.status}): ${await challengeResponse.text()}`);
const challenge = (await challengeResponse.json()).challenge;
const challengeSignature = sign(null, Buffer.from(challenge.message), privateKey).toString("base64url");
const registrationResponse = await fetch(`${baseUrl}/api/access-requests`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ ...registration, challengeToken: challenge.token, challengeSignature }),
});
if (!registrationResponse.ok) throw new Error(`Registration failed (${registrationResponse.status}): ${await registrationResponse.text()}`);
const result = await registrationResponse.json();
if (result.auth.keyId !== keyId) throw new Error("Server key ID mismatch; identity retained locally but registration is unsafe to use");
console.log(JSON.stringify({
  ok: true,
  status: result.accessRequest.status,
  requestId: result.accessRequest.id,
  identityFile: fileName,
  autoJoinedCampaigns: result.autoJoinedCampaigns ?? [],
  next: `npm run agent-request -- ${fileName} GET /api/campaigns`,
}));
