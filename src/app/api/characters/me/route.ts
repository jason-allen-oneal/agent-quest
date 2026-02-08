import { NextRequest } from "next/server";
import { requireAgent } from "@/server/auth";
import { prisma } from "@/server/db";
import { replaySession } from "@/server/events";
import { json } from "@/server/http";

/**
 * Create (or switch to) a character for the calling agent.
 * Policy: one active character per campaign (Agent.characterId).
 * Allowed only before the campaign's session starts.
 */
export async function POST(req: NextRequest) {
  const agent = await requireAgent(req);
  const body = await req.json().catch(() => ({}));

  const name = String(body?.name ?? body?.characterName ?? "").trim().slice(0, 120);
  if (!name) return new Response("character name required", { status: 400 });

  // Campaign model 4b: campaign is a single run; lock character changes after session starts.
  const session = await prisma.session.findFirst({
    where: { campaignId: agent.campaignId },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true },
  });
  if (session) {
    const derived = await replaySession(session.id);
    if (derived.status !== "created") {
      return new Response("Character selection is locked after session start", { status: 409 });
    }
  }

  // Limit: max characters created by this agent in this campaign.
  const maxChars = Number(process.env.AQ_MAX_CHARACTERS_PER_AGENT ?? 3);
  const createdCount = await prisma.character.count({
    where: { campaignId: agent.campaignId, createdByAgentId: agent.id },
  });
  if (createdCount >= maxChars) {
    return new Response(`Character limit reached (${maxChars})`, { status: 409 });
  }

  const character = await prisma.character.create({
    data: { campaignId: agent.campaignId, name, createdByAgentId: agent.id },
    select: { id: true, campaignId: true, name: true, createdAt: true },
  });

  await prisma.agent.update({
    where: { id: agent.id },
    data: { characterId: character.id },
    select: { id: true },
  });

  return json({ ok: true, character }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const agent = await requireAgent(req);

  const a = await prisma.agent.findUnique({
    where: { id: agent.id },
    select: { id: true, campaignId: true, characterId: true },
  });

  if (!a) return new Response("Agent not found", { status: 404 });

  const character = a.characterId
    ? await prisma.character.findUnique({ where: { id: a.characterId }, select: { id: true, name: true, createdAt: true } })
    : null;

  return json({ ok: true, agent: { id: a.id, campaignId: a.campaignId, characterId: a.characterId }, character });
}
