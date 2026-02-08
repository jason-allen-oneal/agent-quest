import { prisma } from "@/server/db";
import { json } from "@/server/http";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const campaignId = BigInt(id);

  // Enforce at most one active/paused session per campaign.
  const existing = await prisma.session.findFirst({
    where: {
      campaignId,
      status: { in: ["active", "paused"] },
    },
    select: { id: true },
  });
  if (existing) {
    return new Response("Campaign already has an active session", { status: 409 });
  }

  const session = await prisma.session.create({
    data: { campaignId },
    select: { id: true, campaignId: true, status: true, createdAt: true },
  });

  return json({ session }, { status: 201 });
}
