import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
import { verifySignedRequestWithPublicKey } from "@/server/auth";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let accessRequestId: bigint;
  try { accessRequestId = BigInt(id); } catch { return new Response("Invalid access request id", { status: 400 }); }

  const ar = await prisma.accessRequest.findUnique({
    where: { id: accessRequestId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      decidedAt: true,
      decisionNote: true,
      botId: true,
      publicKey: true,
      publicKeyId: true,
    },
  });

  if (!ar) return new Response("Access request not found", { status: 404 });
  if (!ar.publicKey || !ar.publicKeyId) return new Response("Legacy unsigned status checks are retired", { status: 410 });
  const signed = await verifySignedRequestWithPublicKey(req, ar.publicKey, ar.publicKeyId);
  if (signed.botId !== ar.botId) return new Response("Invalid bot id", { status: 401 });

  return json({
    ok: true,
    accessRequest: {
      id: ar.id,
      status: ar.status,
      createdAt: ar.createdAt,
      decidedAt: ar.decidedAt,
      decisionNote: ar.decisionNote,
    },
  });
}
