import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
// (platform access requests are not campaign-scoped)
import { normalizeEd25519PublicKey, publicKeyId, sha256Hex } from "@/server/crypto";
import { rateLimit } from "@/server/rate-limit";

const DEFAULT_AUTO_APPROVE_SIGNED_ROLES = new Set(["player", "observer"]);

function autoApproveSignedRoles(): Set<string> {
  const raw = process.env.AQ_AUTO_APPROVE_SIGNED_ROLES;
  if (!raw) return DEFAULT_AUTO_APPROVE_SIGNED_ROLES;
  return new Set(
    raw
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean)
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const botIdForLimit = body?.botId ? String(body.botId).trim().slice(0, 120) : "";
  const limited = rateLimit(req, { id: "access-requests", limit: 20, windowMs: 60_000, key: botIdForLimit });
  if (limited) return limited;

  // Platform-level access request: not campaign-scoped.

  const requestedRoleRaw = String(body?.role ?? body?.requestedRole ?? "observer");
  const allowedRoles = new Set(["gm", "player", "observer"]);
  if (!allowedRoles.has(requestedRoleRaw)) {
    return new Response("role must be gm|player|observer", { status: 400 });
  }
  const requestedRole = requestedRoleRaw as "gm" | "player" | "observer";

  const name = String(body?.name ?? "Agent").slice(0, 120);
  const botId = body?.botId ? String(body.botId).trim().slice(0, 120) : "";
  if (!botId) return new Response("botId required", { status: 400 });
  const message = body?.message ? String(body.message).slice(0, 1000) : null;
  const tagsRaw = Array.isArray(body?.tags) ? body.tags : [];
  const tags = tagsRaw
    .map((t: unknown) => String(t).trim())
    .filter((t: string) => t.length > 0)
    .slice(0, 25);
  const publicKeyRaw = body?.publicKey ? String(body.publicKey).trim() : "";
  let publicKey: string | null = null;
  let keyId: string | null = null;
  if (publicKeyRaw) {
    try {
      publicKey = normalizeEd25519PublicKey(publicKeyRaw);
      keyId = publicKeyId(publicKey);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "invalid publicKey";
      return json({ ok: false, error: msg }, { status: 400 });
    }
  }

  // (no campaign validation: access requests are platform-level)

  const pollToken = crypto.randomBytes(24).toString("base64url");
  const pollTokenHash = sha256Hex(pollToken);

  if (publicKey && keyId && autoApproveSignedRoles().has(requestedRole)) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const existingAccount = await tx.account.findUnique({
          where: { botId },
          select: {
            id: true,
            botId: true,
            name: true,
            platformRole: true,
            publicKeys: {
              where: { revokedAt: null },
              select: { keyId: true },
            },
          },
        });

        if (existingAccount && !existingAccount.publicKeys.some((key) => key.keyId === keyId)) {
          throw new Error("botId already registered with a different public key");
        }

        const existingKey = await tx.accountPublicKey.findUnique({
          where: { keyId },
          select: { accountId: true },
        });
        if (existingKey && (!existingAccount || existingKey.accountId !== existingAccount.id)) {
          throw new Error("publicKey already registered to a different botId");
        }

        const account =
          existingAccount ??
          (await tx.account.create({
            data: {
              botId,
              name,
              platformRole: requestedRole,
            },
            select: { id: true, botId: true, name: true, platformRole: true },
          }));

        if (!existingKey) {
          await tx.accountPublicKey.create({
            data: {
              accountId: account.id,
              keyId,
              publicKey,
            },
            select: { id: true },
          });
        }

        const accessRequest = await tx.accessRequest.create({
          data: {
            requestedRole,
            name,
            botId,
            message,
            tags,
            publicKey,
            publicKeyId: keyId,
            pollTokenHash,
            status: "approved",
            accountId: account.id,
            decidedAt: new Date(),
            decisionNote: "Auto-approved signed public-key onboarding",
          },
          select: {
            id: true,
            requestedRole: true,
            name: true,
            botId: true,
            message: true,
            tags: true,
            publicKeyId: true,
            status: true,
            createdAt: true,
            decidedAt: true,
          },
        });

        return { account, accessRequest };
      });

      return json(
        {
          ok: true,
          account: result.account,
          accessRequest: result.accessRequest,
          auth: {
            type: "signed-ed25519",
            keyId,
            status: "approved; sign AgentQuest API requests with the matching private key",
          },
        },
        { status: 201 }
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ ok: false, error: msg }, { status: 409 });
    }
  }

  const accessRequest = await prisma.accessRequest.create({
    data: {
      requestedRole,
      name,
      botId,
      message,
      tags,
      publicKey,
      publicKeyId: keyId,
      pollTokenHash,
      status: "pending",
    },
    select: {
      id: true,
      requestedRole: true,
      name: true,
      botId: true,
      message: true,
      tags: true,
      publicKeyId: true,
      status: true,
      createdAt: true,
    },
  });

  if (keyId) {
    return json(
      {
        ok: true,
        accessRequest,
        auth: {
          type: "signed-ed25519",
          keyId,
          status: "sign status checks with the matching private key; no bearer secret is issued",
        },
      },
      { status: 201 }
    );
  }

  // Legacy path: return pollToken ONCE so the requesting agent can check status later.
  return json({ ok: true, accessRequest, pollToken, auth: { type: "bearer-claim" } }, { status: 201 });
}
