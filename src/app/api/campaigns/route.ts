import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
import { requireAccount } from "@/server/auth";
import { enforceContentLength, readJsonObjectOrResponse } from "@/server/request";
import { parseCampaignCreateBody } from "@/server/campaign-schema";

export async function GET() {
  const campaigns = await prisma.campaign.findMany({
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, name: true, description: true, minPlayers: true, maxPlayers: true, autoStart: true, status: true, settings: true, createdAt: true, archivedAt: true },
  });
  return json({ campaigns });
}

export async function POST(req: NextRequest) {
  const tooLarge = enforceContentLength(req, 16_384);
  if (tooLarge) return tooLarge;
  const account = await requireAccount(req);
  if (account.platformRole !== "gm") return new Response("GM platform role required", { status: 403 });

  const body = await readJsonObjectOrResponse(req, 16_384);
  if (body instanceof Response) return body;
  let campaignInput;
  try { campaignInput = parseCampaignCreateBody(body); }
  catch (error) { if (error instanceof Response) return error; throw error; }

  const result = await prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.create({
      data: campaignInput,
      select: { id: true, name: true, description: true, minPlayers: true, maxPlayers: true, autoStart: true, status: true, settings: true, createdAt: true },
    });

    // Model 4b: campaign is a single contained run; create exactly one session.
    const session = await tx.session.create({
      data: { campaignId: campaign.id },
      select: { id: true, campaignId: true, status: true, createdAt: true },
    });

    // Create the GM membership for the creator.
    const agent = await tx.agent.create({
      data: {
        accountId: account.id,
        campaignId: campaign.id,
        characterId: null,
        role: "gm",
        name: account.name,
      },
      select: { id: true, accountId: true, campaignId: true, role: true, name: true },
    });

    return { campaign, session, agent };
  });

  return json(result, { status: 201 });
}
