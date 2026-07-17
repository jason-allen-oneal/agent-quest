import { NextRequest } from "next/server";
import { prisma } from "./db";
import { sha256Base64Url, sha256Hex, verifyEd25519 } from "./crypto";

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

function getHeader(req: NextRequest, name: string): string | null {
  const value = req.headers.get(name);
  return value ? value.trim() : null;
}

function signedAuthHeaders(req: NextRequest) {
  const botId = getHeader(req, "x-aq-bot-id");
  const keyId = getHeader(req, "x-aq-key-id");
  const timestamp = getHeader(req, "x-aq-timestamp");
  const nonce = getHeader(req, "x-aq-nonce");
  const signature = getHeader(req, "x-aq-signature");
  if (!botId && !keyId && !timestamp && !nonce && !signature) return null;
  if (!botId || !keyId || !timestamp || !nonce || !signature) {
    throw new Response("Missing signed auth headers", { status: 401 });
  }
  return { botId, keyId, timestamp, nonce, signature };
}

function validateTimestamp(timestamp: string): Date {
  const signedAt = new Date(timestamp);
  const ms = signedAt.getTime();
  if (!Number.isFinite(ms)) throw new Response("Invalid x-aq-timestamp", { status: 401 });

  const maxSkewMs = 5 * 60 * 1000;
  if (Math.abs(Date.now() - ms) > maxSkewMs) {
    throw new Response("Expired signed request", { status: 401 });
  }

  return signedAt;
}

async function signedRequestMessage(req: NextRequest, timestamp: string, nonce: string): Promise<string> {
  const url = new URL(req.url);
  const pathWithSearch = `${url.pathname}${url.search}`;
  const body = Buffer.from(await req.clone().arrayBuffer());
  if (body.length > 65_536) throw new Response("Request body too large", { status: 413 });
  const bodyHash = sha256Base64Url(body);

  return ["v1", req.method.toUpperCase(), pathWithSearch, timestamp, nonce, bodyHash].join("\n");
}

export async function verifySignedRequestWithPublicKey(
  req: NextRequest,
  publicKey: string,
  keyId: string
): Promise<{ botId: string; keyId: string }> {
  const headers = signedAuthHeaders(req);
  if (!headers) throw new Response("Missing signed auth headers", { status: 401 });
  if (headers.keyId !== keyId) throw new Response("Invalid key id", { status: 401 });

  validateTimestamp(headers.timestamp);
  const message = await signedRequestMessage(req, headers.timestamp, headers.nonce);
  if (!verifyEd25519(publicKey, message, headers.signature)) {
    throw new Response("Invalid request signature", { status: 401 });
  }

  return { botId: headers.botId, keyId: headers.keyId };
}

async function requireSignedAccount(req: NextRequest): Promise<AuthedAccount> {
  const headers = signedAuthHeaders(req);
  if (!headers) {
    throw new Response("Missing Authorization: Bearer <apiKey> or signed AgentQuest auth headers", { status: 401 });
  }

  validateTimestamp(headers.timestamp);

  const key = await prisma.accountPublicKey.findUnique({
    where: { keyId: headers.keyId },
    include: { account: true },
  });
  if (!key || key.revokedAt) throw new Response("Invalid key id", { status: 401 });
  if (key.account.botId !== headers.botId) throw new Response("Invalid bot id", { status: 401 });

  const message = await signedRequestMessage(req, headers.timestamp, headers.nonce);
  if (!verifyEd25519(key.publicKey, message, headers.signature)) {
    throw new Response("Invalid request signature", { status: 401 });
  }

  try {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await prisma.authNonce.create({
      data: { keyId: headers.keyId, nonce: headers.nonce.slice(0, 120), expiresAt },
      select: { id: true },
    });

    if (Math.random() < 0.02) {
      await prisma.authNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    }
  } catch {
    throw new Response("Replayed signed request", { status: 401 });
  }

  const a = key.account;
  return {
    id: a.id,
    botId: a.botId,
    name: a.name,
    platformRole: a.platformRole as AuthedAccount["platformRole"],
  };
}

export async function requireAccount(req: NextRequest): Promise<AuthedAccount> {
  const token = getBearerToken(req);
  if (!token) return requireSignedAccount(req);

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
export async function requireSingleCampaignAgent(req: NextRequest, campaignId?: bigint): Promise<AuthedAgent> {
  if (campaignId !== undefined) return requireAgentForCampaign(req, campaignId);

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
