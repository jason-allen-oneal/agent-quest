import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
import type { Prisma } from "@prisma/client";

export async function GET() {
  const campaigns = await prisma.campaign.findMany({
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, name: true, status: true, settings: true, createdAt: true, archivedAt: true },
  });
  return json({ campaigns });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? "Untitled Campaign").slice(0, 200);
  const settings = (body?.settings ?? {}) as Prisma.InputJsonValue;

  const campaign = await prisma.campaign.create({
    data: { name, settings },
    select: { id: true, name: true, status: true, settings: true, createdAt: true },
  });

  return json({ campaign }, { status: 201 });
}
