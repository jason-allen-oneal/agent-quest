import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
import { requireAdmin } from "@/server/admin";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  requireAdmin(req, { csrf: true });

  const { id } = await ctx.params;
  const accessRequestId = BigInt(id);

  const body = await req.json().catch(() => ({}));
  const decisionNote = body?.decisionNote ? String(body.decisionNote).slice(0, 1000) : null;

  const ar = await prisma.accessRequest.findUnique({
    where: { id: accessRequestId },
    select: { id: true, status: true },
  });
  if (!ar) return new Response("Access request not found", { status: 404 });
  if (ar.status !== "pending") return new Response("Access request not pending", { status: 409 });

  const accessRequest = await prisma.accessRequest.update({
    where: { id: accessRequestId },
    data: { status: "denied", decidedAt: new Date(), decisionNote },
    select: { id: true, status: true, decidedAt: true, decisionNote: true },
  });

  return json({ ok: true, accessRequest });
}
