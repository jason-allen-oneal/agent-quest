#!/usr/bin/env node
import { createHash, createPrivateKey, randomBytes, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function bodyHash(rawBody) {
  return createHash("sha256").update(rawBody).digest("base64url");
}

export function canonicalRequestMessage({ method, pathWithQuery, timestamp, nonce, rawBody = "" }) {
  return ["v1", method.toUpperCase(), pathWithQuery, timestamp, nonce, bodyHash(rawBody)].join("\n");
}

export function signedHeaders(identity, method, pathWithQuery, rawBody = "", options = {}) {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const nonce = options.nonce ?? randomBytes(18).toString("base64url");
  const message = canonicalRequestMessage({ method, pathWithQuery, timestamp, nonce, rawBody });
  const privateKey = createPrivateKey(identity.auth.privateKeyPkcs8Pem);
  const signature = sign(null, Buffer.from(message), privateKey).toString("base64url");
  return {
    "x-aq-bot-id": identity.botId,
    "x-aq-key-id": identity.auth.keyId,
    "x-aq-timestamp": timestamp,
    "x-aq-nonce": nonce,
    "x-aq-signature": signature,
  };
}

function usage() {
  return "Usage: node scripts/agentquest-request.mjs <identity.json> <METHOD> </api/path?query> [raw-json-body] [idempotency-key]";
}

function validateIdentity(identity) {
  if (identity?.service !== "AgentQuest" || identity?.auth?.type !== "signed-ed25519") {
    throw new Error("Not an AgentQuest signed identity bundle");
  }
  if (!identity.baseUrl || !identity.botId || !identity.auth.keyId || !identity.auth.privateKeyPkcs8Pem) {
    throw new Error("Identity bundle is incomplete");
  }
}

export async function main(argv = process.argv.slice(2)) {
  const [identityPath, rawMethod, pathWithQuery, rawBody = "", idempotencyKey] = argv;
  const method = rawMethod?.toUpperCase();
  if (!identityPath || !method || !pathWithQuery?.startsWith("/api/") || !/^[A-Z]+$/u.test(method)) {
    console.error(usage());
    return 2;
  }

  const identity = JSON.parse(await readFile(identityPath, "utf8"));
  validateIdentity(identity);
  if (rawBody) JSON.parse(rawBody);

  const baseUrl = String(identity.baseUrl).replace(/\/$/u, "");
  const url = new URL(pathWithQuery, `${baseUrl}/`);
  if (url.origin !== new URL(baseUrl).origin || !url.pathname.startsWith("/api/")) {
    throw new Error("Request must stay on the identity bundle's AgentQuest API origin");
  }

  const headers = signedHeaders(identity, method, `${url.pathname}${url.search}`, rawBody);
  if (rawBody) headers["content-type"] = "application/json";
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

  const response = await fetch(url, { method, headers, body: rawBody || undefined });
  const text = await response.text();
  process.stdout.write(`${text}${text.endsWith("\n") ? "" : "\n"}`);
  return response.ok ? 0 : 1;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
