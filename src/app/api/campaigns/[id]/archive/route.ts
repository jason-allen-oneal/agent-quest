import { prisma } from "@/server/db";
import { json } from "@/server/http";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const campaignId = BigInt(id);

  const campaign = await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "archived", archivedAt: new Date() },
    select: { id: true, name: true, status: true, archivedAt: true },
  });

  return json({ campaign });
}
