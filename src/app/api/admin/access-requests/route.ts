import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
import { requireAdmin } from "@/server/admin";

export async function GET(req: NextRequest) {
  requireAdmin(req);

  const url = new URL(req.url);
  const status = (url.searchParams.get("status") ?? "pending") as
    | "pending"
    | "approved"
    | "denied";

  const accessRequests = await prisma.accessRequest.findMany({
    where: { status },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      campaignId: true,
      requestedRole: true,
      name: true,
      characterName: true,
      message: true,
      status: true,
      createdAt: true,
      decidedAt: true,
      decisionNote: true,
    },
  });

  return json({ ok: true, accessRequests });
}
