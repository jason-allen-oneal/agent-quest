import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireSingleCampaignAgent } from "@/server/auth";
import { prisma } from "@/server/db";
import { appendEvent, replaySession } from "@/server/events";
import { json, jsonErrorResponse } from "@/server/http";
import { enforceContentLength, readJsonObjectOrResponse, requireIdempotencyKey } from "@/server/request";
import { assertContentPolicy } from "@/server/content-policy";
import { parseCharacterSheet } from "@/server/rpg-rules";
import { maybeAutoStartCampaign } from "@/server/session-start";
import { sha256Hex } from "@/server/crypto";
import { parseIpScreeningEvidence, parseRightsBasis, type IpScreeningEvidence } from "@/server/ip-screening";
import { planStartedCharacterUpsert } from "@/server/onboarding";

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

function actorSnapshot(agentId: bigint, name: string, sheet: ReturnType<typeof parseCharacterSheet>) {
  return {
    agentId: agentId.toString(),
    name,
    ...sheet,
    vitality: sheet.maxVitality,
    focus: sheet.maxFocus,
    conditions: [],
  };
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

/**
 * Temporary recovery endpoint for campaigns that started before a player could
 * finish character creation. It replaces the player's starting character and
 * emits a canonical actor snapshot so replayed session state agrees with the
 * character record.
 *
 * Remove this endpoint once existing affected campaigns have been repaired.
 */
export async function PATCH(req: NextRequest) {
  try {
    const tooLarge = enforceContentLength(req, 2_048);
    if (tooLarge) return jsonErrorResponse(tooLarge);
    const campaignId = requestedCampaignId(req);
    if (campaignId instanceof Response) return jsonErrorResponse(campaignId);
    const agent = await requireSingleCampaignAgent(req, campaignId);
    if (agent.role !== "player") return jsonErrorResponse(new Response("Player role required", { status: 403 }));
    const idempotencyKey = requireIdempotencyKey(req);
    const body = await readJsonObjectOrResponse(req, 2_048);
    if (body instanceof Response) return jsonErrorResponse(body);

    let characterInput;
    try { characterInput = parseCharacterInput(body); }
    catch (error) { if (error instanceof Response) return jsonErrorResponse(error); throw error; }
    const { name, ipScreening, sheet } = characterInput;

    const session = await prisma.session.findFirst({
      where: { campaignId: agent.campaignId },
      orderBy: [{ createdAt: "desc" }],
      select: { id: true, status: true },
    });
    if (!session) return jsonErrorResponse(new Response("Campaign session not found", { status: 404 }));
    const state = await replaySession(session.id);
    const mode = planStartedCharacterUpsert({
      role: agent.role,
      sessionStatus: state.status,
      characterId: agent.characterId,
      actorInitialized: Boolean(state.actors[agent.id.toString()]),
    });

    const replacement = {
      name,
      sheet,
      ipScreening,
      actor: actorSnapshot(agent.id, name, sheet),
    };
    const idempotencyHash = sha256Hex(JSON.stringify(replacement));
    const existing = await prisma.event.findFirst({
      where: { sessionId: session.id, agentId: agent.id, idempotencyKey },
      select: { type: true, idempotencyHash: true, payload: true },
    });
    if (existing) {
      const expectedType = mode === "create" && !state.actors[agent.id.toString()]
        ? "ACTOR_INITIALIZED"
        : "CHARACTER_REPLACED";
      if (existing.type !== expectedType || existing.idempotencyHash !== idempotencyHash) {
        return jsonErrorResponse(new Response("Idempotency-Key was already used with a different request", { status: 409 }));
      }
      const replayedAgent = await prisma.agent.findUnique({ where: { id: agent.id }, select: { characterId: true } });
      const replayedCharacter = replayedAgent?.characterId
        ? await prisma.character.findUnique({ where: { id: replayedAgent.characterId }, select: { id: true, campaignId: true, name: true, sheet: true, createdAt: true } })
        : null;
      return json({ ok: true, created: mode === "create", replaced: mode === "replace", replayed: true, character: replayedCharacter, event: existing });
    }

    const character = mode === "create"
      ? await prisma.$transaction(async (tx) => {
        const created = await tx.character.create({
          data: { campaignId: agent.campaignId, name, sheet, createdByAgentId: agent.id },
          select: { id: true, campaignId: true, name: true, sheet: true, createdAt: true },
        });
        await tx.agent.update({ where: { id: agent.id }, data: { characterId: created.id }, select: { id: true } });
        return created;
      })
      : await prisma.character.update({
        where: { id: agent.characterId! },
        data: { name, sheet },
        select: { id: true, campaignId: true, name: true, sheet: true, createdAt: true },
      });
    const eventType = mode === "create" && !state.actors[agent.id.toString()]
      ? "ACTOR_INITIALIZED"
      : "CHARACTER_REPLACED";
    const event = await appendEvent({
      campaignId: agent.campaignId,
      sessionId: session.id,
      agentId: agent.id,
      idempotencyKey,
      idempotencyHash,
      type: eventType,
      payload: { actor: replacement.actor, ipScreening, replacedAtMs: Date.now() },
    });
    if (ipScreening) {
      await prisma.contentReview.create({
        data: {
          campaignId: agent.campaignId,
          characterId: character.id,
          eventId: event.id,
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
    return json({ ok: true, created: mode === "create", replaced: mode === "replace", character, event }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) return jsonErrorResponse(error);
    throw error;
  }
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
