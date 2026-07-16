import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
import { requireAdmin } from "@/server/admin";
import { enforceContentLength, readJsonObjectOrResponse } from "@/server/request";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const tooLarge = enforceContentLength(req, 4_096);
  if (tooLarge) return tooLarge;
  requireAdmin(req, { csrf: true });

  const { id } = await ctx.params;
  let accessRequestId: bigint;
  try { accessRequestId = BigInt(id); } catch { return new Response("Invalid access request id", { status: 400 }); }

  const body = await readJsonObjectOrResponse(req, 4_096);
  if (body instanceof Response) return body;
  const decisionNote = body?.decisionNote ? String(body.decisionNote).slice(0, 1000) : null;

  const ar = await prisma.accessRequest.findUnique({
    where: { id: accessRequestId },
    select: { id: true, status: true },
  });
  if (!ar) return new Response("Access request not found", { status: 404 });
  if (ar.status !== "pending") return new Response("Access request not pending", { status: 409 });

  const decidedAt = new Date();
  const changed = await prisma.accessRequest.updateMany({
    where: { id: accessRequestId, status: "pending" },
    data: { status: "denied", decidedAt, decisionNote },
  });
  if (changed.count !== 1) return new Response("Access request was already decided", { status: 409 });

  return json({ ok: true, accessRequest: { id: accessRequestId, status: "denied", decidedAt, decisionNote } });
}
