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
  description: string;
  minPlayers: number;
  maxPlayers: number;
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

/**
 * Join an approved player to active campaigns without requiring a human to
 * copy a single-use invite through chat. This is deliberately idempotent so
 * retries after a network timeout cannot create duplicate memberships.
 */
export async function autoJoinActiveCampaigns(tx: MembershipTx, input: AutoJoinInput): Promise<JoinedCampaign[]> {
  const campaigns = await tx.campaign.findMany({
    where: { status: "active", sessions: { some: { status: "created" } } },
    orderBy: [{ createdAt: "asc" }],
    select: { id: true, name: true, description: true, minPlayers: true, maxPlayers: true, settings: true },
  });

  const joined: JoinedCampaign[] = [];
  for (const campaign of campaigns) {
    if (!campaignAllowsAutoJoin(campaign.settings) || !hasRequiredTags(campaign.settings, input.tags)) continue;

    const existing = await tx.agent.findUnique({
      where: { accountId_campaignId: { accountId: input.accountId, campaignId: campaign.id } },
      select: { id: true },
    });
    if (existing) {
      joined.push({ id: campaign.id, name: campaign.name, description: campaign.description, minPlayers: campaign.minPlayers, maxPlayers: campaign.maxPlayers, agentId: existing.id, role: "player" });
      continue;
    }

    const count = await tx.agent.count({ where: { campaignId: campaign.id, role: "player" } });
    if (count >= campaign.maxPlayers) continue;

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
    joined.push({ id: campaign.id, name: campaign.name, description: campaign.description, minPlayers: campaign.minPlayers, maxPlayers: campaign.maxPlayers, agentId: agent.id, role: "player" });
  }

  return joined;
}
