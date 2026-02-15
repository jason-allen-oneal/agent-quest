import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
import { sha256Hex } from "@/server/crypto";
import { requireAccount } from "@/server/auth";

export async function POST(req: NextRequest) {
  const account = await requireAccount(req);
  const body = await req.json().catch(() => ({}));

  const inviteCode = String(body?.inviteCode ?? "").trim();
  if (!inviteCode) return new Response("inviteCode required", { status: 400 });

  const requestedName = body?.name ? String(body.name).trim().slice(0, 120) : null;
  const name = requestedName || account.name;

  const codeHash = sha256Hex(inviteCode);

  try {
    const result = await prisma.$transaction(async (tx) => {
    const invite = await tx.campaignInvite.findFirst({
      where: { codeHash, remainingUses: { gt: 0 } },
      select: { id: true, campaignId: true, remainingUses: true },
    });
    if (!invite) throw new Error("Invalid or expired invite");

    const campaign = await tx.campaign.findUnique({ where: { id: invite.campaignId }, select: { settings: true } });
    const settings = (campaign?.settings ?? {}) as Record<string, unknown>;

    // Enforce campaign roleCaps.player
    const roleCapsRaw = settings.roleCaps;
    const roleCaps = roleCapsRaw && typeof roleCapsRaw === "object" ? (roleCapsRaw as Record<string, unknown>) : null;
    const capRaw = roleCaps ? roleCaps["player"] : null;
    const cap = typeof capRaw === "number" ? capRaw : null;
    if (cap !== null) {
      const count = await tx.agent.count({ where: { campaignId: invite.campaignId, role: "player" } });
      if (count >= cap) throw new Error("Role cap reached for player");
    }

    // Create membership if not already a member.
    const existing = await tx.agent.findUnique({
      where: { accountId_campaignId: { accountId: account.id, campaignId: invite.campaignId } },
      select: { id: true, accountId: true, campaignId: true, role: true, name: true, characterId: true },
    });

    const agent =
      existing ??
      (await tx.agent.create({
        data: {
          accountId: account.id,
          campaignId: invite.campaignId,
          characterId: null,
          role: "player",
          name,
        },
        select: { id: true, accountId: true, campaignId: true, role: true, name: true, characterId: true },
      }));

    // Consume invite (single-use). If the member already existed, we still consume the invite.
    await tx.campaignInvite.update({
      where: { id: invite.id },
      data: {
        remainingUses: { decrement: 1 },
        usedAt: new Date(),
        usedByAccountId: account.id,
      },
      select: { id: true },
    });

    return { agent, campaignId: invite.campaignId };
    });

    return json({ ok: true, ...result }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("Role cap") ? 409 : 400;
    return new Response(msg, { status });
  }
}
