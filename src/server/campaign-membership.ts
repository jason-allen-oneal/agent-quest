import type { Prisma } from "@prisma/client";

type MembershipTx = Pick<Prisma.TransactionClient, "campaign" | "agent">;

type AutoJoinInput = {
  accountId: bigint;
  name: string;
  tags: string[];
};

type JoinedCampaign = {
  id: bigint;
  name: string;
  agentId: bigint;
  role: "player";
};

function campaignAllowsAutoJoin(settings: unknown): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return true;
  return (settings as Record<string, unknown>).autoJoinPlayers !== false;
}

function hasRequiredTags(settings: unknown, tags: string[]): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return true;
  const required = (settings as Record<string, unknown>).requiredTags;
  if (!Array.isArray(required)) return true;
  const provided = new Set(tags);
  return required.every((tag) => typeof tag === "string" && provided.has(tag));
}

function playerCap(settings: unknown): number | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const caps = (settings as Record<string, unknown>).roleCaps;
  if (!caps || typeof caps !== "object" || Array.isArray(caps)) return null;
  const cap = (caps as Record<string, unknown>).player;
  return typeof cap === "number" && Number.isInteger(cap) && cap >= 0 ? cap : null;
}

/**
 * Join an approved player to active campaigns without requiring a human to
 * copy a single-use invite through chat. This is deliberately idempotent so
 * retries after a network timeout cannot create duplicate memberships.
 */
export async function autoJoinActiveCampaigns(tx: MembershipTx, input: AutoJoinInput): Promise<JoinedCampaign[]> {
  const campaigns = await tx.campaign.findMany({
    where: { status: "active" },
    orderBy: [{ createdAt: "asc" }],
    select: { id: true, name: true, settings: true },
  });

  const joined: JoinedCampaign[] = [];
  for (const campaign of campaigns) {
    if (!campaignAllowsAutoJoin(campaign.settings) || !hasRequiredTags(campaign.settings, input.tags)) continue;

    const existing = await tx.agent.findUnique({
      where: { accountId_campaignId: { accountId: input.accountId, campaignId: campaign.id } },
      select: { id: true },
    });
    if (existing) {
      joined.push({ id: campaign.id, name: campaign.name, agentId: existing.id, role: "player" });
      continue;
    }

    const cap = playerCap(campaign.settings);
    if (cap !== null) {
      const count = await tx.agent.count({ where: { campaignId: campaign.id, role: "player" } });
      if (count >= cap) continue;
    }

    const agent = await tx.agent.create({
      data: {
        accountId: input.accountId,
        campaignId: campaign.id,
        characterId: null,
        role: "player",
        name: input.name,
      },
      select: { id: true },
    });
    joined.push({ id: campaign.id, name: campaign.name, agentId: agent.id, role: "player" });
  }

  return joined;
}
