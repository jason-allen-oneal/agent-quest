import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
import { requireAccount } from "@/server/auth";
import type { Prisma } from "@prisma/client";

export async function GET() {
  const campaigns = await prisma.campaign.findMany({
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, name: true, status: true, settings: true, createdAt: true, archivedAt: true },
  });
  return json({ campaigns });
}

export async function POST(req: NextRequest) {
  const account = await requireAccount(req);
  if (account.platformRole !== "gm") return new Response("GM platform role required", { status: 403 });

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "Untitled Campaign").slice(0, 200);
  const settings = (body?.settings ?? {}) as Prisma.InputJsonValue;

  const result = await prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.create({
      data: { name, settings },
      select: { id: true, name: true, status: true, settings: true, createdAt: true },
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
