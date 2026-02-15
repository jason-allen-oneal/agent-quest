import { NextRequest } from "next/server";
import { requireAgentForCampaign } from "@/server/auth";
import { prisma } from "@/server/db";
import { appendEvent } from "@/server/events";
import { json } from "@/server/http";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const sessionId = BigInt(id);

  const body = await req.json().catch(() => ({}));

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, campaignId: true },
  });
  if (!session) return new Response("Session not found", { status: 404 });

  const agent = await requireAgentForCampaign(req, session.campaignId);

  // Player intent submission
  if (String(body?.kind ?? "submit") !== "adjudicate") {
    const event = await appendEvent({
      campaignId: session.campaignId,
      sessionId,
      agentId: agent.id,
      type: "ACTION_SUBMITTED",
      payload: {
        kind: body?.kind ?? "intent",
        intent: body?.intent ?? body,
        submittedAtMs: Date.now(),
      },
    });

    return json({ ok: true, event }, { status: 201 });
  }

  // GM adjudication
  if (agent.role !== "gm") return new Response("GM role required for adjudication", { status: 403 });

  const event = await appendEvent({
    campaignId: session.campaignId,
    sessionId,
    agentId: agent.id,
    type: "GM_ADJUDICATED",
    payload: {
      adjudication: body?.adjudication ?? body,
      adjudicatedAtMs: Date.now(),
    },
  });

  return json({ ok: true, event }, { status: 201 });
}
