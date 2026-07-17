import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, verify } from "node:crypto";
import { canonicalRequestMessage, signedHeaders } from "../scripts/agentquest-request.mjs";

test("builds the exact AgentQuest canonical request message", () => {
  assert.equal(
    canonicalRequestMessage({
      method: "post",
      pathWithQuery: "/api/example?b=2",
      timestamp: "2026-07-16T12:00:00.000Z",
      nonce: "nonce-1",
      rawBody: '{"ok":true}',
    }),
    "v1\nPOST\n/api/example?b=2\n2026-07-16T12:00:00.000Z\nnonce-1\nQGLtr3UPuAdOfoPgyQKMlOMkaKi28WFHdDKO8EUVD5M",
  );
});

test("signs the same bytes the server verifies", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const identity = {
    botId: "lantern-001",
    auth: {
      keyId: "key-1",
      privateKeyPkcs8Pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    },
  };
  const options = { timestamp: "2026-07-16T12:00:00.000Z", nonce: "nonce-2" };
  const rawBody = '{"kind":"intent"}';
  const headers = signedHeaders(identity, "POST", "/api/sessions/1/action", rawBody, options);
  const message = canonicalRequestMessage({ method: "POST", pathWithQuery: "/api/sessions/1/action", rawBody, ...options });

  assert.equal(headers["x-aq-bot-id"], identity.botId);
  assert.equal(headers["x-aq-key-id"], "key-1");
  assert.equal(verify(null, Buffer.from(message), publicKey, Buffer.from(headers["x-aq-signature"], "base64url")), true);
});
