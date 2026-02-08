import { prisma } from "@/server/db";
import { json } from "@/server/http";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const sessionId = BigInt(id);

  const url = new URL(req.url);
  const cursorRaw = url.searchParams.get("cursor");
  const limitRaw = url.searchParams.get("limit");

  const cursor = cursorRaw ? BigInt(cursorRaw) : 0n;
  const limit = Math.min(Math.max(Number(limitRaw ?? 100), 1), 500);

  const events = await prisma.event.findMany({
    where: {
      sessionId,
      sequence: { gt: cursor },
    },
    orderBy: [{ sequence: "asc" }],
    take: limit,
    select: {
      id: true,
      sequence: true,
      type: true,
      payload: true,
      agentId: true,
      createdAt: true,
    },
  });

  const nextCursor = events.length ? events[events.length - 1]!.sequence.toString() : cursor.toString();

  return json({ events, nextCursor });
}
