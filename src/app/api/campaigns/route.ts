import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { json, jsonErrorResponse } from "@/server/http";
import { requireAccount } from "@/server/auth";
import { enforceContentLength, readJsonObjectOrResponse } from "@/server/request";
import { parseCampaignCreateBody } from "@/server/campaign-schema";

export async function GET() {
  const campaigns = await prisma.campaign.findMany({
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, name: true, description: true, minPlayers: true, maxPlayers: true, autoStart: true, status: true, rightsStatus: true, contentPolicyVersion: true, settings: true, createdAt: true, archivedAt: true },
  });
  return json({ campaigns });
}

export async function POST(req: NextRequest) {
  const tooLarge = enforceContentLength(req, 16_384);
  if (tooLarge) return jsonErrorResponse(tooLarge);
  const account = await requireAccount(req);
  if (account.platformRole !== "gm") return jsonErrorResponse(new Response("GM platform role required", { status: 403 }));

  const body = await readJsonObjectOrResponse(req, 16_384);
  if (body instanceof Response) return jsonErrorResponse(body);
  let campaignInput;
  try { campaignInput = parseCampaignCreateBody(body); }
  catch (error) { if (error instanceof Response) return jsonErrorResponse(error); throw error; }

  const result = await prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.create({
      data: campaignInput.data,
      select: { id: true, name: true, description: true, minPlayers: true, maxPlayers: true, autoStart: true, status: true, rightsStatus: true, contentPolicyVersion: true, settings: true, createdAt: true },
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

    await tx.contentReview.create({
      data: {
        campaignId: campaign.id,
        accountId: account.id,
        agentId: agent.id,
        surface: "campaign_title",
        subjectHash: campaignInput.review.subjectHash,
        decision: campaignInput.review.status,
        rightsBasis: campaignInput.review.rightsBasis,
        policyVersion: campaignInput.review.policyVersion,
        checkedAt: new Date(campaignInput.review.checkedAt),
        evidence: campaignInput.review as unknown as Prisma.InputJsonValue,
      },
    });
    for (const element of campaignInput.namedElements) {
      await tx.contentReview.create({
        data: {
          campaignId: campaign.id,
          accountId: account.id,
          agentId: agent.id,
          surface: `campaign_${element.kind}`,
          subjectHash: element.ipScreening.subjectHash,
          decision: element.ipScreening.status,
          rightsBasis: element.rightsBasis,
          policyVersion: element.ipScreening.policyVersion,
          checkedAt: new Date(element.ipScreening.checkedAt),
          evidence: element.ipScreening as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return { campaign, session, agent };
  });

  return json(result, { status: 201 });
}
