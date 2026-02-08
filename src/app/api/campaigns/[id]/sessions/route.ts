import { prisma } from "@/server/db";
import { json } from "@/server/http";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const campaignId = BigInt(id);

  const sessions = await prisma.session.findMany({
    where: { campaignId },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, campaignId: true, status: true, createdAt: true, startedAt: true, endedAt: true },
    take: 200,
  });

  // Add a cheap "last sequence" map for UI.
  const lastBySession = await prisma.event.groupBy({
    by: ["sessionId"],
    where: { campaignId },
    _max: { sequence: true, createdAt: true },
  });

  const lastMap = new Map(
    lastBySession.map((r) => [
      r.sessionId.toString(),
      { lastSequence: r._max.sequence?.toString() ?? "0", lastEventAt: r._max.createdAt?.toISOString() ?? null },
    ])
  );

  return json({
    ok: true,
    sessions: sessions.map((s) => {
      const extra = lastMap.get(s.id.toString());
      return {
        ...s,
        lastSequence: extra?.lastSequence ?? "0",
        lastEventAt: extra?.lastEventAt ?? null,
      };
    }),
  });
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const campaignId = BigInt(id);

  // Model 4b: a campaign is a single contained run (1 campaign = 1 session).
  const existing = await prisma.session.findFirst({
    where: { campaignId },
    select: { id: true },
  });
  if (existing) {
    return new Response("Campaign already has a session", { status: 409 });
  }

  const session = await prisma.session.create({
    data: { campaignId },
    select: { id: true, campaignId: true, status: true, createdAt: true },
  });

  return json({ session }, { status: 201 });
}
