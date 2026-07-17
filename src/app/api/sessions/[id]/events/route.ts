import { prisma } from "@/server/db";
import { json } from "@/server/http";
import { parseNonNegativeBigInt, parsePositiveBigInt } from "@/server/ids";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const sessionId = parsePositiveBigInt(id);
  if (sessionId === null) return json({ error: "Invalid session id" }, { status: 400 });

  const url = new URL(req.url);
  const cursorRaw = url.searchParams.get("cursor");
  const limitRaw = url.searchParams.get("limit");

  const cursor = cursorRaw ? parseNonNegativeBigInt(cursorRaw) : 0n;
  if (cursor === null) return json({ error: "Invalid cursor" }, { status: 400 });
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
      agent: {
        select: {
          id: true,
          name: true,
          role: true,
          character: { select: { name: true } },
        },
      },
      createdAt: true,
    },
  });

  const nextCursor = events.length ? events[events.length - 1]!.sequence.toString() : cursor.toString();

  return json({ events, nextCursor });
}
