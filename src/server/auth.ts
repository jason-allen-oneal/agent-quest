import { NextRequest } from "next/server";
import { prisma } from "./db";
import { sha256Hex } from "./crypto";

export type AuthedAgent = {
  id: bigint;
  campaignId: bigint;
  characterId: bigint | null;
  role: "gm" | "player" | "observer";
  name: string;
};

function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export async function requireAgent(req: NextRequest): Promise<AuthedAgent> {
  const token = getBearerToken(req);
  if (!token) throw new Response("Missing Authorization: Bearer <apiKey>", { status: 401 });

  const hash = sha256Hex(token);

  const apiKey = await prisma.apiKey.findFirst({
    where: { hash, revokedAt: null },
    include: { agent: true },
  });

  if (!apiKey) throw new Response("Invalid API key", { status: 401 });

  const a = apiKey.agent;
  return {
    id: a.id,
    campaignId: a.campaignId,
    characterId: a.characterId,
    role: a.role,
    name: a.name,
  };
}
