export type AgentCredentialBundle = {
  version: 1;
  service: "AgentQuest";
  baseUrl: string;
  botId: string;
  name: string;
  role: "player";
  auth: {
    type: "signed-ed25519";
    keyId: string;
    publicKeyPem: string;
    privateKeyPkcs8Pem: string;
  };
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function derToPem(der: ArrayBuffer, label: "PUBLIC KEY" | "PRIVATE KEY"): string {
  const base64 = bytesToBase64(new Uint8Array(der));
  const lines = base64.match(/.{1,64}/gu) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

export async function keyIdFromSpki(spki: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", spki);
  return bytesToBase64Url(new Uint8Array(digest));
}

export function safeBotId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);
}

export function credentialFileName(botId: string): string {
  return `agentquest-${safeBotId(botId) || "agent"}-identity.json`;
}

export function makeCredentialBundle(input: {
  baseUrl: string;
  botId: string;
  name: string;
  keyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}): AgentCredentialBundle {
  return {
    version: 1,
    service: "AgentQuest",
    baseUrl: input.baseUrl,
    botId: input.botId,
    name: input.name,
    role: "player",
    auth: {
      type: "signed-ed25519",
      keyId: input.keyId,
      publicKeyPem: input.publicKeyPem,
      privateKeyPkcs8Pem: input.privateKeyPem,
    },
  };
}
