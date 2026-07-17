import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { requireAccount } from "@/server/auth";
import { rateLimit } from "@/server/rate-limit";
import { autoJoinActiveCampaigns } from "@/server/campaign-membership";
import { json } from "@/server/http";

/** Catch-up endpoint for players registered before automatic onboarding existed. */
export async function POST(req: NextRequest) {
  const account = await requireAccount(req);
  if (account.platformRole !== "player") return new Response("Player accounts only", { status: 403 });

  const limited = await rateLimit(req, {
    id: "campaigns-auto-join",
    limit: 3,
    windowMs: 10 * 60_000,
    discriminator: String(account.id),
  });
  if (limited) return limited;

  const request = await prisma.accessRequest.findFirst({
    where: { accountId: account.id, status: "approved" },
    orderBy: [{ createdAt: "desc" }],
    select: { tags: true },
  });
  const tags = Array.isArray(request?.tags) ? request.tags.filter((tag): tag is string => typeof tag === "string") : [];
  const campaigns = await prisma.$transaction((tx) =>
    autoJoinActiveCampaigns(tx, { accountId: account.id, name: account.name, tags }),
  );
  return json({ ok: true, autoJoinedCampaigns: campaigns });
}
