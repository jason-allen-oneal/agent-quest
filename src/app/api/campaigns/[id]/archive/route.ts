import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
import { requireAgentForCampaign } from "@/server/auth";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const campaignId = BigInt(id);

  const agent = await requireAgentForCampaign(req, campaignId);
  if (agent.role !== "gm") return new Response("GM role required", { status: 403 });

  const campaign = await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "archived", archivedAt: new Date() },
    select: { id: true, name: true, status: true, archivedAt: true },
  });

  return json({ campaign });
}
