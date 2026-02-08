import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
import { sha256Hex } from "@/server/crypto";

function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const accessRequestId = BigInt(id);

  const token = getBearerToken(req);
  if (!token) return new Response("Missing Authorization: Bearer <pollToken>", { status: 401 });
  const tokenHash = sha256Hex(token);

  const ar = await prisma.accessRequest.findUnique({
    where: { id: accessRequestId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      decidedAt: true,
      decisionNote: true,
      pollTokenHash: true,
      claimedAt: true,
    },
  });

  if (!ar) return new Response("Access request not found", { status: 404 });
  if (ar.pollTokenHash !== tokenHash) return new Response("Invalid poll token", { status: 403 });

  return json({
    ok: true,
    accessRequest: {
      id: ar.id,
      status: ar.status,
      createdAt: ar.createdAt,
      decidedAt: ar.decidedAt,
      decisionNote: ar.decisionNote,
      claimedAt: ar.claimedAt,
    },
  });
}
