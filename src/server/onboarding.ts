import crypto from "node:crypto";
import { normalizeEd25519PublicKey, publicKeyId, timingSafeEqualHex, verifyEd25519 } from "./crypto.ts";

export type Registration = {
  role: "gm" | "player" | "observer";
  name: string;
  botId: string;
  message: string | null;
  tags: string[];
  publicKey: string;
  keyId: string;
};

function challengeSecret(): string {
  const secret = process.env.AQ_ONBOARDING_CHALLENGE_SECRET;
  if (!secret || secret.length < 32) throw new Error("AQ_ONBOARDING_CHALLENGE_SECRET must be at least 32 characters");
  return secret;
}

export function parseRegistration(body: Record<string, unknown>): Registration {
  const role = String(body.role ?? body.requestedRole ?? "");
  if (role !== "gm" && role !== "player" && role !== "observer") throw new Response("role must be gm|player|observer", { status: 400 });
  const name = String(body.name ?? "").trim();
  if (!name || name.length > 120) throw new Response("name must be 1-120 characters", { status: 400 });
  const botId = String(body.botId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{3,120}$/.test(botId)) throw new Response("botId must be 3-120 letters, numbers, dashes, or underscores", { status: 400 });
  const message = body.message == null ? null : String(body.message).trim();
  if (message && message.length > 1000) throw new Response("message must be at most 1000 characters", { status: 400 });
  if (body.tags != null && !Array.isArray(body.tags)) throw new Response("tags must be an array", { status: 400 });
  const tags = (Array.isArray(body.tags) ? body.tags : []).map((v) => String(v).trim());
  if (tags.length > 25 || tags.some((v) => !v || v.length > 50)) throw new Response("tags must contain at most 25 non-empty values of 50 characters", { status: 400 });
  const rawKey = String(body.publicKey ?? "").trim();
  if (!rawKey || rawKey.length > 4096) throw new Response("publicKey is required and must be at most 4096 characters", { status: 400 });
  let publicKey: string;
  try { publicKey = normalizeEd25519PublicKey(rawKey); }
  catch (error) { throw new Response(error instanceof Error ? error.message : "Invalid public key", { status: 400 }); }
  return { role, name, botId, message: message || null, tags, publicKey, keyId: publicKeyId(publicKey) };
}

export function canonicalRegistration(reg: Registration): string {
  return JSON.stringify({ role: reg.role, name: reg.name, botId: reg.botId, message: reg.message, tags: reg.tags, publicKey: reg.publicKey, keyId: reg.keyId });
}

export function issueRegistrationChallenge(reg: Registration, now = Date.now()) {
  const payload = {
    v: 1,
    exp: now + 5 * 60_000,
    nonce: crypto.randomBytes(18).toString("base64url"),
    digest: crypto.createHash("sha256").update(canonicalRegistration(reg)).digest("hex"),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", challengeSecret()).update(encoded).digest("hex");
  const token = `${encoded}.${mac}`;
  return { token, message: `agentquest-registration-v1\n${token}`, expiresAt: new Date(payload.exp).toISOString() };
}

export function verifyRegistrationChallenge(reg: Registration, token: string, signature: string, now = Date.now()): boolean {
  const [encoded, mac, extra] = token.split(".");
  if (!encoded || !mac || extra || token.length > 2000) return false;
  const expected = crypto.createHmac("sha256", challengeSecret()).update(encoded).digest("hex");
  if (!timingSafeEqualHex(mac, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { v?: unknown; exp?: unknown; digest?: unknown };
    const digest = crypto.createHash("sha256").update(canonicalRegistration(reg)).digest("hex");
    if (payload.v !== 1 || typeof payload.exp !== "number" || payload.exp <= now || payload.exp > now + 6 * 60_000 || payload.digest !== digest) return false;
    return verifyEd25519(reg.publicKey, `agentquest-registration-v1\n${token}`, signature);
  } catch { return false; }
}
