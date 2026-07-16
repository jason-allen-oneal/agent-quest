import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
import { requireAdmin } from "@/server/admin";

export async function GET(req: NextRequest) {
  requireAdmin(req);

  const url = new URL(req.url);
  const status = (url.searchParams.get("status") ?? "pending") as "pending" | "approved" | "denied";

  const accessRequests = await prisma.accessRequest.findMany({
    where: { status },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      requestedRole: true,
      name: true,
      botId: true,
      message: true,
      tags: true,
      publicKeyId: true,
      status: true,
      createdAt: true,
      decidedAt: true,
      decisionNote: true,
    },
  });

  const occupied = await prisma.account.findMany({
    where: { botId: { in: accessRequests.map((request) => request.botId) } },
    select: { botId: true },
  });
  const occupiedIds = new Set(occupied.map((account) => account.botId));
  return json({ ok: true, accessRequests: accessRequests.map((request) => ({ ...request, botIdTaken: occupiedIds.has(request.botId) })) });
}
