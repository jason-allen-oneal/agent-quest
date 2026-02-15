import { NextRequest } from "next/server";
import { prisma } from "./db";
import { sha256Hex } from "./crypto";

export type AuthedAccount = {
  id: bigint;
  botId: string;
  name: string;
  platformRole: "gm" | "player" | "observer";
};

export type AuthedAgent = {
  id: bigint;
  accountId: bigint;
  campaignId: bigint;
  characterId: bigint | null;
  role: "gm" | "player" | "observer";
  name: string;
};

function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export async function requireAccount(req: NextRequest): Promise<AuthedAccount> {
  const token = getBearerToken(req);
  if (!token) throw new Response("Missing Authorization: Bearer <apiKey>", { status: 401 });

  const hash = sha256Hex(token);

  const apiKey = await prisma.apiKey.findFirst({
    where: { hash, revokedAt: null },
    include: { account: true },
  });

  if (!apiKey) throw new Response("Invalid API key", { status: 401 });

  const a = apiKey.account;
  return {
    id: a.id,
    botId: a.botId,
    name: a.name,
    platformRole: a.platformRole as AuthedAccount["platformRole"],
  };
}

export async function requireAgentForCampaign(req: NextRequest, campaignId: bigint): Promise<AuthedAgent> {
  const account = await requireAccount(req);

  const agent = await prisma.agent.findUnique({
    where: { accountId_campaignId: { accountId: account.id, campaignId } },
    select: { id: true, accountId: true, campaignId: true, characterId: true, role: true, name: true },
  });

  if (!agent) throw new Response("Not a member of this campaign", { status: 403 });

  return {
    id: agent.id,
    accountId: agent.accountId,
    campaignId: agent.campaignId,
    characterId: agent.characterId,
    role: agent.role as AuthedAgent["role"],
    name: agent.name,
  };
}

/**
 * Back-compat helper for endpoints that are not campaign-scoped.
 * If the account belongs to exactly one campaign, returns that Agent; otherwise errors.
 */
export async function requireSingleCampaignAgent(req: NextRequest): Promise<AuthedAgent> {
  const account = await requireAccount(req);
  const agents = await prisma.agent.findMany({
    where: { accountId: account.id },
    orderBy: [{ createdAt: "desc" }],
    take: 2,
    select: { id: true, accountId: true, campaignId: true, characterId: true, role: true, name: true },
  });

  if (agents.length === 0) throw new Response("Account is not a member of any campaign", { status: 403 });
  if (agents.length > 1) {
    throw new Response("Ambiguous campaign: this account belongs to multiple campaigns; use a campaign-scoped endpoint", {
      status: 400,
    });
  }

  const agent = agents[0]!;
  return {
    id: agent.id,
    accountId: agent.accountId,
    campaignId: agent.campaignId,
    characterId: agent.characterId,
    role: agent.role as AuthedAgent["role"],
    name: agent.name,
  };
}
