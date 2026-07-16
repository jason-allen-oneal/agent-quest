import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
import { sha256Hex } from "@/server/crypto";
import { parseRegistration, verifyRegistrationChallenge } from "@/server/onboarding";
import { rateLimitMany } from "@/server/rate-limit";
import { readJsonObjectOrResponse } from "@/server/request";

const DEFAULT_AUTO_APPROVE = new Set(["player", "observer"]);
function autoApproveRoles() {
  const configured = process.env.AQ_AUTO_APPROVE_SIGNED_ROLES;
  return configured ? new Set(configured.split(",").map((v) => v.trim()).filter(Boolean)) : DEFAULT_AUTO_APPROVE;
}

export async function POST(req: NextRequest) {
  const body = await readJsonObjectOrResponse(req, 16_384);
  if (body instanceof Response) return body;
  let registration;
  try { registration = parseRegistration(body); }
  catch (error) { if (error instanceof Response) return error; throw error; }
  const challengeToken = String(body.challengeToken ?? "");
  const challengeSignature = String(body.challengeSignature ?? "");
  if (!challengeToken || !challengeSignature || !verifyRegistrationChallenge(registration, challengeToken, challengeSignature)) {
    return json({ ok: false, error: "Invalid, expired, or mismatched registration proof" }, { status: 401 });
  }
  const limited = await rateLimitMany(req, [
    // Many legitimate agents may share one NAT or server egress IP. The
    // per-bot limit remains strict; this IP limit only contains fleet-wide
    // bursts and should not serialize normal onboarding.
    { id: "registration-global", scope: "global", limit: 300, windowMs: 60_000 },
    { id: "registration-ip", limit: 30, windowMs: 10 * 60_000 },
    { id: "registration-bot", scope: "subject", discriminator: registration.botId, limit: 2, windowMs: 60 * 60_000 },
  ]);
  if (limited) return limited;

  const pollTokenHash = sha256Hex(crypto.randomBytes(32).toString("base64url"));
  const autoApprove = autoApproveRoles().has(registration.role);
  try {
    const result = await prisma.$transaction(async (tx) => {
      if (await tx.account.findUnique({ where: { botId: registration.botId }, select: { id: true } })) {
        throw new Response("botId is already registered", { status: 409 });
      }
      if (await tx.accountPublicKey.findUnique({ where: { keyId: registration.keyId }, select: { id: true } })) {
        throw new Response("public key is already registered", { status: 409 });
      }
      if (await tx.accessRequest.findFirst({ where: { botId: registration.botId, status: "pending" }, select: { id: true } })) {
        throw new Response("A request for this botId is already pending", { status: 409 });
      }

      if (!autoApprove) {
        const accessRequest = await tx.accessRequest.create({
          data: { requestedRole: registration.role, name: registration.name, botId: registration.botId, message: registration.message, tags: registration.tags, publicKey: registration.publicKey, publicKeyId: registration.keyId, pollTokenHash },
          select: { id: true, requestedRole: true, name: true, botId: true, message: true, tags: true, publicKeyId: true, status: true, createdAt: true },
        });
        return { accessRequest, account: null };
      }

      // New-account onboarding is intentionally create-only. Recovery, rotation,
      // names, and roles belong to separate authenticated workflows.
      const account = await tx.account.create({
        data: { botId: registration.botId, name: registration.name, platformRole: registration.role },
        select: { id: true, botId: true, name: true, platformRole: true },
      });
      await tx.accountPublicKey.create({ data: { accountId: account.id, keyId: registration.keyId, publicKey: registration.publicKey } });
      const accessRequest = await tx.accessRequest.create({
        data: { requestedRole: registration.role, name: registration.name, botId: registration.botId, message: registration.message, tags: registration.tags, publicKey: registration.publicKey, publicKeyId: registration.keyId, pollTokenHash, status: "approved", accountId: account.id, decidedAt: new Date(), decisionNote: "Auto-approved after Ed25519 proof-of-possession" },
        select: { id: true, requestedRole: true, name: true, botId: true, message: true, tags: true, publicKeyId: true, status: true, createdAt: true, decidedAt: true },
      });
      return { accessRequest, account };
    });

    return json({ ok: true, account: result.account, accessRequest: result.accessRequest, auth: { type: "signed-ed25519", keyId: registration.keyId, status: autoApprove ? "approved" : "pending manual review" } }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ ok: false, error: "botId or public key is already registered" }, { status: 409 });
  }
}
