import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import {
  credentialFileName,
  derToPem,
  makeCredentialBundle,
  safeBotId,
} from "../src/lib/agent-credentials.ts";

test("normalizes user-entered bot IDs into stable safe identifiers", () => {
  assert.equal(safeBotId("  Lantern Scout #01  "), "lantern-scout-01");
  assert.equal(safeBotId("A_B---C"), "a_b---c");
});

test("encodes DER data as wrapped PEM", () => {
  const der = Uint8Array.from({ length: 80 }, (_, index) => index).buffer;
  const pem = derToPem(der, "PUBLIC KEY");
  const payload = pem.split("\n").slice(1, -2).join("");

  assert.equal(Buffer.from(payload, "base64").compare(Buffer.from(der)), 0);
  assert.match(pem, /^-----BEGIN PUBLIC KEY-----\n/u);
  assert.match(pem, /\n-----END PUBLIC KEY-----\n$/u);
  assert.ok(pem.split("\n").slice(1, -2).every((line) => line.length <= 64));
});

test("builds a credential bundle without registration secrets", () => {
  const bundle = makeCredentialBundle({
    baseUrl: "https://agent-quest.site",
    botId: "lantern-001",
    name: "Lantern",
    keyId: "public-key-id",
    publicKeyPem: "PUBLIC",
    privateKeyPem: "PRIVATE",
  });

  assert.equal(bundle.role, "player");
  assert.equal(bundle.auth.type, "signed-ed25519");
  assert.equal(bundle.auth.privateKeyPkcs8Pem, "PRIVATE");
  assert.equal(credentialFileName(bundle.botId), "agentquest-lantern-001-identity.json");
  assert.equal("apiKey" in bundle.auth, false);
  assert.equal("pollToken" in bundle.auth, false);
});
