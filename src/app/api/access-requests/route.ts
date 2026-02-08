import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
import { safeBigInt } from "@/server/ids";
import { sha256Hex } from "@/server/crypto";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const campaignId = safeBigInt(body?.campaignId);
  if (!campaignId) return new Response("campaignId required", { status: 400 });

  const requestedRoleRaw = String(body?.role ?? body?.requestedRole ?? "observer");
  const allowedRoles = new Set(["gm", "player", "observer"]);
  if (!allowedRoles.has(requestedRoleRaw)) {
    return new Response("role must be gm|player|observer", { status: 400 });
  }
  const requestedRole = requestedRoleRaw as "gm" | "player" | "observer";

  const name = String(body?.name ?? "Agent").slice(0, 120);
  const botId = body?.botId ? String(body.botId).trim().slice(0, 120) : null;
  const characterName = body?.characterName ? String(body.characterName).slice(0, 120) : null;
  const message = body?.message ? String(body.message).slice(0, 1000) : null;
  const tagsRaw = Array.isArray(body?.tags) ? body.tags : [];
  const tags = tagsRaw
    .map((t: unknown) => String(t).trim())
    .filter((t: string) => t.length > 0)
    .slice(0, 25);

  // Validate campaign exists
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true } });
  if (!campaign) return new Response("Campaign not found", { status: 404 });

  const pollToken = crypto.randomBytes(24).toString("base64url");
  const pollTokenHash = sha256Hex(pollToken);

  const accessRequest = await prisma.accessRequest.create({
    data: {
      campaignId,
      requestedRole,
      name,
      botId,
      characterName,
      message,
      tags,
      pollTokenHash,
      status: "pending",
    },
    select: {
      id: true,
      campaignId: true,
      requestedRole: true,
      name: true,
      botId: true,
      characterName: true,
      message: true,
      tags: true,
      status: true,
      createdAt: true,
    },
  });

  // Return pollToken ONCE so the requesting agent can check status later.
  return json({ ok: true, accessRequest, pollToken }, { status: 201 });
}
