import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
import { requireAdmin } from "@/server/admin";
import { readJsonObjectOrResponse } from "@/server/request";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  requireAdmin(req, { csrf: true });
  const { id } = await ctx.params;
  let accessRequestId: bigint;
  try { accessRequestId = BigInt(id); } catch { return new Response("Invalid access request id", { status: 400 }); }
  const body = await readJsonObjectOrResponse(req, 4096);
  if (body instanceof Response) return body;
  const decisionNote = body.decisionNote == null ? null : String(body.decisionNote).slice(0, 1000);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const ar = await tx.accessRequest.findUnique({ where: { id: accessRequestId } });
      if (!ar) throw new Response("Access request not found", { status: 404 });
      if (ar.status !== "pending") throw new Response("Access request not pending", { status: 409 });
      if (!ar.publicKey || !ar.publicKeyId) throw new Response("Unsigned legacy requests cannot be approved", { status: 409 });
      if (await tx.account.findUnique({ where: { botId: ar.botId }, select: { id: true } })) {
        throw new Response("botId already belongs to an account; use an authenticated account-management workflow", { status: 409 });
      }
      if (await tx.accountPublicKey.findUnique({ where: { keyId: ar.publicKeyId }, select: { id: true } })) {
        throw new Response("public key already belongs to an account", { status: 409 });
      }
      const claimed = await tx.accessRequest.updateMany({ where: { id: ar.id, status: "pending" }, data: { status: "approved", decidedAt: new Date(), decisionNote } });
      if (claimed.count !== 1) throw new Response("Access request was already decided", { status: 409 });
      const account = await tx.account.create({ data: { botId: ar.botId, name: ar.name, platformRole: ar.requestedRole }, select: { id: true, botId: true, name: true, platformRole: true } });
      await tx.accountPublicKey.create({ data: { accountId: account.id, keyId: ar.publicKeyId, publicKey: ar.publicKey } });
      await tx.accessRequest.update({ where: { id: ar.id }, data: { accountId: account.id } });
      return { account, keyId: ar.publicKeyId };
    });
    return json({ ok: true, account: result.account, auth: { type: "signed-ed25519", keyId: result.keyId } }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ ok: false, error: "botId or public key collision" }, { status: 409 });
  }
}
