import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
// (platform access requests are not campaign-scoped)
import { sha256Hex } from "@/server/crypto";
import { rateLimit } from "@/server/rate-limit";

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

  // (no campaign validation: access requests are platform-level)

  const pollToken = crypto.randomBytes(24).toString("base64url");
  const pollTokenHash = sha256Hex(pollToken);

  const accessRequest = await prisma.accessRequest.create({
    data: {
      requestedRole,
      name,
      botId,
      message,
      tags,
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
      status: true,
      createdAt: true,
    },
  });

  // Return pollToken ONCE so the requesting agent can check status later.
  return json({ ok: true, accessRequest, pollToken }, { status: 201 });
}
