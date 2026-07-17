import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireSingleCampaignAgent } from "@/server/auth";
import { prisma } from "@/server/db";
import { replaySession } from "@/server/events";
import { json, jsonErrorResponse } from "@/server/http";
import { enforceContentLength, readJsonObjectOrResponse } from "@/server/request";
import { assertContentPolicy } from "@/server/content-policy";
import { parseCharacterSheet } from "@/server/rpg-rules";
import { maybeAutoStartCampaign } from "@/server/session-start";
import { parseIpScreeningEvidence, parseRightsBasis, type IpScreeningEvidence } from "@/server/ip-screening";

function requestedCampaignId(req: NextRequest): bigint | Response | undefined {
  const raw = new URL(req.url).searchParams.get("campaignId");
  if (raw === null) return undefined;
  try {
    const id = BigInt(raw);
    return id > 0n ? id : new Response("Invalid campaignId", { status: 400 });
  } catch {
    return new Response("Invalid campaignId", { status: 400 });
  }
}

function parseCharacterInput(body: Record<string, unknown>) {
  const name = String(body.name ?? body.characterName ?? "").trim().slice(0, 120);
  if (!name) throw new Response("character name required", { status: 400 });
  assertContentPolicy(name, "character name", "player-name");
  const hasScreening = body.ipScreening != null || body.rightsBasis != null;
  const rightsBasis = hasScreening ? parseRightsBasis(body.rightsBasis ?? "original") : null;
  const ipScreening: IpScreeningEvidence | null = hasScreening
    ? parseIpScreeningEvidence(body.ipScreening, { subject: name, rightsBasis: rightsBasis!, label: "ipScreening" })
    : null;
  const sheet = parseCharacterSheet(body.sheet);
  return { name, rightsBasis, ipScreening, sheet };
}

/**
 * Create (or switch to) a character for the calling agent.
 * Policy: one active character per campaign (Agent.characterId).
 * Allowed only before the campaign's session starts.
 */
export async function POST(req: NextRequest) {
  const tooLarge = enforceContentLength(req, 2_048);
  if (tooLarge) return jsonErrorResponse(tooLarge);
  const campaignId = requestedCampaignId(req);
  if (campaignId instanceof Response) return jsonErrorResponse(campaignId);
  const agent = await requireSingleCampaignAgent(req, campaignId);
  const body = await readJsonObjectOrResponse(req, 2_048);
  if (body instanceof Response) return jsonErrorResponse(body);

  let characterInput;
  try { characterInput = parseCharacterInput(body); }
  catch (error) { if (error instanceof Response) return jsonErrorResponse(error); throw error; }
  const { name, ipScreening, sheet } = characterInput;

  // Campaign model 4b: campaign is a single run; lock character changes after session starts.
  const session = await prisma.session.findFirst({
    where: { campaignId: agent.campaignId },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true },
  });
  if (session) {
    const derived = await replaySession(session.id);
    if (derived.status !== "created") {
      return jsonErrorResponse(new Response("Character selection is locked after session start", { status: 409 }));
    }
  }

  // Limit: max characters created by this agent in this campaign.
  const maxChars = Number(process.env.AQ_MAX_CHARACTERS_PER_AGENT ?? 3);
  const createdCount = await prisma.character.count({
    where: { campaignId: agent.campaignId, createdByAgentId: agent.id },
  });
  if (createdCount >= maxChars) {
    return jsonErrorResponse(new Response(`Character limit reached (${maxChars})`, { status: 409 }));
  }

  const character = await prisma.$transaction(async (tx) => {
    const created = await tx.character.create({
      data: { campaignId: agent.campaignId, name, sheet, createdByAgentId: agent.id },
      select: { id: true, campaignId: true, name: true, sheet: true, createdAt: true },
    });
    await tx.agent.update({
      where: { id: agent.id },
      data: { characterId: created.id },
      select: { id: true },
    });
    if (ipScreening) {
      await tx.contentReview.create({
        data: {
          campaignId: agent.campaignId,
          characterId: created.id,
          accountId: agent.accountId,
          agentId: agent.id,
          surface: "character_name",
          subjectHash: ipScreening.subjectHash,
          decision: ipScreening.status,
          rightsBasis: ipScreening.rightsBasis,
          policyVersion: ipScreening.policyVersion,
          checkedAt: new Date(ipScreening.checkedAt),
          evidence: ipScreening as unknown as Prisma.InputJsonValue,
        },
      });
    }
    return created;
  });

  const autoStart = await maybeAutoStartCampaign(agent.campaignId);
  return json({ ok: true, character, autoStart }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const campaignId = requestedCampaignId(req);
  if (campaignId instanceof Response) return campaignId;
  const agent = await requireSingleCampaignAgent(req, campaignId);

  const a = await prisma.agent.findUnique({
    where: { id: agent.id },
    select: { id: true, campaignId: true, characterId: true },
  });

  if (!a) return new Response("Agent not found", { status: 404 });

  const character = a.characterId
    ? await prisma.character.findUnique({ where: { id: a.characterId }, select: { id: true, name: true, sheet: true, createdAt: true } })
    : null;

  return json({ ok: true, agent: { id: a.id, campaignId: a.campaignId, characterId: a.characterId }, character });
}
