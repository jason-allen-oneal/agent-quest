import { prisma } from "./db.ts";
import { appendEvents, type AppendEventInput } from "./events.ts";
import { parseStoredCharacterSheet } from "./rpg-rules.ts";
import { orderedTurnActors } from "./turns.ts";

type ReadyMember = { id: bigint; role: "gm" | "player"; characterId: bigint | null };

export type AutoStartReadiness = {
  enabled: boolean;
  ready: boolean;
  minimumPlayers: number;
  maximumPlayers: number;
  playerCount: number;
  readyPlayerCount: number;
  reason: "disabled" | "missing_gm" | "waiting_for_players" | "waiting_for_characters" | "ready";
};

export function evaluateAutoStartReadiness(configuration: unknown, members: ReadyMember[]): AutoStartReadiness {
  const input = configuration && typeof configuration === "object" && !Array.isArray(configuration)
    ? configuration as Record<string, unknown>
    : {};
  const enabled = input.autoStart !== false;
  const configuredMinimum = input.minPlayers;
  const minimumPlayers = typeof configuredMinimum === "number"
    && Number.isInteger(configuredMinimum)
    && configuredMinimum >= 1
    && configuredMinimum <= 20
    ? configuredMinimum
    : 2;
  const configuredMaximum = input.maxPlayers;
  const maximumPlayers = typeof configuredMaximum === "number"
    && Number.isInteger(configuredMaximum)
    && configuredMaximum >= minimumPlayers
    && configuredMaximum <= 20
    ? configuredMaximum
    : 6;
  const players = members.filter((member) => member.role === "player");
  const readyPlayerCount = players.filter((member) => member.characterId !== null).length;
  const hasGm = members.some((member) => member.role === "gm");
  const reason = !enabled
    ? "disabled"
    : !hasGm
      ? "missing_gm"
      : players.length < minimumPlayers
        ? "waiting_for_players"
        : readyPlayerCount !== players.length
          ? "waiting_for_characters"
          : "ready";
  return {
    enabled,
    ready: reason === "ready",
    minimumPlayers,
    maximumPlayers,
    playerCount: players.length,
    readyPlayerCount,
    reason,
  };
}

export async function startSession(sessionId: bigint, initiatingGmAgentId: bigint) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, campaignId: true, status: true },
  });
  if (!session) throw new Response("Session not found", { status: 404 });
  if (session.status === "active") return { ok: true, session, idempotent: true };
  if (session.status !== "created" && session.status !== "paused") {
    throw new Response("Stopped sessions cannot be restarted", { status: 409 });
  }

  const previousStatus = session.status;
  const now = Date.now();
  const events: AppendEventInput[] = [{
    campaignId: session.campaignId,
    sessionId,
    agentId: initiatingGmAgentId,
    idempotencyKey: previousStatus === "created" ? "session-started" : `session-resumed-${now}`,
    type: "SESSION_STARTED",
    payload: { startedAtMs: now },
  }];

  if (previousStatus === "created") {
    const members = await prisma.agent.findMany({
      where: { campaignId: session.campaignId, role: { in: ["gm", "player"] } },
      select: { id: true, role: true, name: true, character: { select: { name: true, sheet: true } } },
    });
    const order = orderedTurnActors(members.map((member) => ({ id: member.id, role: member.role as "gm" | "player" })));
    const gm = order.find((member) => member.role === "gm");
    if (!gm) throw new Response("A GM is required to start the session", { status: 409 });
    if (gm.id !== initiatingGmAgentId) throw new Response("Initiating agent is not this campaign's GM", { status: 403 });

    for (const member of members.filter((candidate) => candidate.role === "player")) {
      if (!member.character) throw new Response(`Player ${member.id} must create a character before session start`, { status: 409 });
      const sheet = parseStoredCharacterSheet(member.character.sheet);
      events.push({
        campaignId: session.campaignId,
        sessionId,
        agentId: member.id,
        type: "ACTOR_INITIALIZED",
        payload: {
          actor: {
            agentId: member.id.toString(),
            name: member.character.name ?? member.name,
            ...sheet,
            vitality: sheet.maxVitality,
            focus: sheet.maxFocus,
            conditions: [],
          },
        },
      });
    }
    events.push(
      { campaignId: session.campaignId, sessionId, agentId: initiatingGmAgentId, type: "ROUND_STARTED", payload: { roundNumber: 1, startedAtMs: now } },
      {
        campaignId: session.campaignId,
        sessionId,
        agentId: gm.id,
        type: "TURN_ADVANCED",
        payload: { turnNumber: 1, roundNumber: 1, agentId: gm.id.toString(), phase: "awaiting_adjudication", startedAtMs: now, reason: "session_started" },
      },
    );
  }

  const transitioned = await prisma.session.updateMany({
    where: { id: sessionId, status: previousStatus },
    data: { status: "active", startedAt: new Date() },
  });
  if (transitioned.count !== 1) return { ok: true, idempotent: true };
  await appendEvents(events);
  return { ok: true, sessionId, idempotent: false };
}

export async function maybeAutoStartCampaign(campaignId: bigint) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      minPlayers: true,
      maxPlayers: true,
      autoStart: true,
      sessions: { where: { status: "created" }, orderBy: { createdAt: "asc" }, take: 1, select: { id: true } },
      agents: { where: { role: { in: ["gm", "player"] } }, select: { id: true, role: true, characterId: true } },
    },
  });
  if (!campaign?.sessions[0]) return { started: false, readiness: null };
  const members = campaign.agents.map((member) => ({ ...member, role: member.role as "gm" | "player" }));
  const readiness = evaluateAutoStartReadiness(
    { minPlayers: campaign.minPlayers, maxPlayers: campaign.maxPlayers, autoStart: campaign.autoStart },
    members,
  );
  if (!readiness.ready) return { started: false, readiness };
  const gm = members.find((member) => member.role === "gm")!;
  const result = await startSession(campaign.sessions[0].id, gm.id);
  return { started: !result.idempotent, sessionId: campaign.sessions[0].id, readiness };
}
