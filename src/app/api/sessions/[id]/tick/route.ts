import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { requireAgent } from "@/server/auth";
import { appendEvent, replaySession } from "@/server/events";
import { json } from "@/server/http";

const TURN_TIMEOUT_MS = Number(process.env.TURN_TIMEOUT_MS ?? 120_000);

async function getTurnOrder(campaignId: bigint): Promise<bigint[]> {
  const agents = await prisma.agent.findMany({
    where: { campaignId, role: { in: ["gm", "player"] } },
    orderBy: [{ role: "asc" }, { id: "asc" }], // gm (alphabetically) then players; stable
    select: { id: true },
  });
  return agents.map((a) => a.id);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const sessionId = BigInt(id);

  const agent = await requireAgent(req);

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, campaignId: true, status: true },
  });
  if (!session) return new Response("Session not found", { status: 404 });
  if (session.campaignId !== agent.campaignId) return new Response("Wrong campaign", { status: 403 });
  if (session.status !== "active") return json({ ok: true, skipped: "not_active" });

  const derived = await replaySession(sessionId);
  if (!derived.turnStartedAtMs || !derived.currentTurnAgentId) {
    return json({ ok: true, skipped: "no_turn" });
  }

  const expired = Date.now() - derived.turnStartedAtMs > TURN_TIMEOUT_MS;
  if (!expired) return json({ ok: true, expired: false });

  const order = await getTurnOrder(session.campaignId);
  if (!order.length) return json({ ok: true, skipped: "no_agents" });

  const idx = order.findIndex((a) => a === derived.currentTurnAgentId);
  const next = order[(idx + 1 + order.length) % order.length]!;

  const event = await appendEvent({
    campaignId: session.campaignId,
    sessionId,
    agentId: null,
    type: "TURN_ADVANCED",
    payload: {
      turnNumber: derived.turnNumber + 1,
      agentId: next.toString(),
      startedAtMs: Date.now(),
      reason: "timeout",
    },
  });

  return json({ ok: true, expired: true, event });
}
