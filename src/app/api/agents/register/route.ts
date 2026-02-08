import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { sha256Hex } from "@/server/crypto";
import { json } from "@/server/http";

function makeApiKey(): string {
  // base64url without padding
  return crypto.randomBytes(24).toString("base64url");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const campaignId = BigInt(body?.campaignId);
  const roleRaw = String(body?.role ?? "observer");
  const name = String(body?.name ?? "Agent").slice(0, 120);

  if (!campaignId) return new Response("campaignId required", { status: 400 });
  if (!["gm", "player", "observer"].includes(roleRaw)) {
    return new Response("role must be gm|player|observer", { status: 400 });
  }
  const role = roleRaw as "gm" | "player" | "observer";

  // Optional: create character by name.
  const characterName = body?.characterName ? String(body.characterName).slice(0, 120) : null;

  const result = await prisma.$transaction(async (tx) => {
    let characterId: bigint | null = null;
    if (characterName) {
      const c = await tx.character.create({
        data: { campaignId, name: characterName },
        select: { id: true },
      });
      characterId = c.id;
    }

    const agent = await tx.agent.create({
      data: {
        campaignId,
        characterId,
        role,
        name,
      },
      select: { id: true, campaignId: true, characterId: true, role: true, name: true, createdAt: true },
    });

    const apiKey = makeApiKey();
    const hash = sha256Hex(apiKey);

    await tx.apiKey.create({
      data: { agentId: agent.id, hash },
      select: { id: true },
    });

    return { agent, apiKey };
  });

  // apiKey is returned ONLY once.
  return json(result, { status: 201 });
}
