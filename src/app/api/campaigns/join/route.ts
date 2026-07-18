import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
import { sha256Hex } from "@/server/crypto";
import { requireAccount } from "@/server/auth";
import { rateLimit } from "@/server/rate-limit";
import { enforceContentLength, readJsonObjectOrResponse } from "@/server/request";
import { assertContentPolicy } from "@/server/content-policy";
import { assertCampaignRoleAvailable } from "@/server/campaign-membership";

export async function POST(req: NextRequest) {
  const tooLarge = enforceContentLength(req, 4_096);
  if (tooLarge) return tooLarge;
  const account = await requireAccount(req);
  if (account.platformRole === "observer") return new Response("Observer accounts are read-only", { status: 403 });
  const limited = await rateLimit(req, { id: "campaigns-join", limit: 10, windowMs: 60_000, discriminator: String(account.id) });
  if (limited) return limited;

  const body = await readJsonObjectOrResponse(req, 4_096);
  if (body instanceof Response) return body;

  const inviteCode = String(body?.inviteCode ?? "").trim();
  if (!inviteCode) return new Response("inviteCode required", { status: 400 });

  const requestedName = body?.name ? String(body.name).trim().slice(0, 120) : null;
  const name = requestedName || account.name;
  try { assertContentPolicy(name, "agent display name", "player-name"); }
  catch (error) { if (error instanceof Response) return error; throw error; }

  const codeHash = sha256Hex(inviteCode);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const invite = await tx.campaignInvite.findFirst({
        where: { codeHash, remainingUses: { gt: 0 } },
        select: { id: true, campaignId: true, remainingUses: true },
      });
      if (!invite) throw new Error("Invalid or expired invite");

      const campaign = await tx.campaign.findUnique({ where: { id: invite.campaignId }, select: { maxPlayers: true } });
      const openSession = await tx.session.findFirst({ where: { campaignId: invite.campaignId, status: "created" }, select: { id: true } });
      if (!openSession) throw new Error("Campaign membership is locked after the session starts");

      // Create membership if not already a member.
      const existing = await tx.agent.findUnique({
        where: { accountId_campaignId: { accountId: account.id, campaignId: invite.campaignId } },
        select: { id: true, accountId: true, campaignId: true, role: true, name: true, characterId: true },
      });

      if (existing) {
        assertCampaignRoleAvailable(existing.role, "player");
        return { agent: existing, campaignId: invite.campaignId, alreadyMember: true };
      }

      const count = await tx.agent.count({ where: { campaignId: invite.campaignId, role: "player" } });
      if (!campaign || count >= campaign.maxPlayers) throw new Error("Player maximum reached");

      const agent =
        await tx.agent.create({
          data: {
            accountId: account.id,
            campaignId: invite.campaignId,
            characterId: null,
            role: "player",
            name,
          },
          select: { id: true, accountId: true, campaignId: true, role: true, name: true, characterId: true },
        });

      // Consume invite (single-use). Conditional update prevents double-spend on concurrent requests.
      const updated = await tx.campaignInvite.updateMany({
        where: { id: invite.id, remainingUses: { gt: 0 } },
        data: {
          remainingUses: { decrement: 1 },
          usedAt: new Date(),
          usedByAccountId: account.id,
        },
      });
      if (updated.count === 0) throw new Error("Invalid or expired invite");

      return { agent, campaignId: invite.campaignId };
    });

    return json({ ok: true, ...result }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("maximum") || msg.includes("membership is locked") ? 409 : 400;
    return new Response(msg, { status });
  }
}
