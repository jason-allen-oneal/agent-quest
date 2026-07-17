import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { requireAgentForCampaign } from "@/server/auth";
import { appendEvents, type AppendEventInput } from "@/server/events";
import { json } from "@/server/http";
import { parseStoredCharacterSheet } from "@/server/rpg-rules";
import { orderedTurnActors } from "@/server/turns";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const sessionId = BigInt(id);

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, campaignId: true, status: true },
  });
  if (!session) return new Response("Session not found", { status: 404 });

  const agent = await requireAgentForCampaign(req, session.campaignId);
  if (agent.role !== "gm") return new Response("GM role required", { status: 403 });

  if (session.status === "active") return json({ ok: true, session, idempotent: true });
  if (session.status !== "created" && session.status !== "paused") return new Response("Stopped sessions cannot be restarted", { status: 409 });
  const previousStatus = session.status;
  const now = Date.now();
  const events: AppendEventInput[] = [{
    campaignId: session.campaignId,
    sessionId,
    agentId: agent.id,
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
    if (!gm) return new Response("A GM is required to start the session", { status: 409 });
    for (const member of members.filter((candidate) => candidate.role === "player")) {
      const sheet = parseStoredCharacterSheet(member.character?.sheet);
      events.push({
        campaignId: session.campaignId,
        sessionId,
        agentId: member.id,
        type: "ACTOR_INITIALIZED",
        payload: {
          actor: {
            agentId: member.id.toString(),
            name: member.character?.name ?? member.name,
            ...sheet,
            vitality: sheet.maxVitality,
            focus: sheet.maxFocus,
            conditions: [],
          },
        },
      });
    }
    events.push(
      { campaignId: session.campaignId, sessionId, agentId: agent.id, type: "ROUND_STARTED", payload: { roundNumber: 1, startedAtMs: now } },
      {
        campaignId: session.campaignId,
        sessionId,
        agentId: gm.id,
        type: "TURN_ADVANCED",
        payload: { turnNumber: 1, roundNumber: 1, agentId: gm.id.toString(), phase: "awaiting_adjudication", startedAtMs: now, reason: "session_started" },
      },
    );
  }

  // Mark status (cache) + append canonical event.
  const transitioned = await prisma.session.updateMany({
    where: { id: sessionId, status: previousStatus },
    data: { status: "active", startedAt: new Date() },
  });
  if (transitioned.count !== 1) return json({ ok: true, idempotent: true });

  await appendEvents(events);

  return json({ ok: true });
}
