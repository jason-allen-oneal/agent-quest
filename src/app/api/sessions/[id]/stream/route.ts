import { prisma } from "@/server/db";

function sse(data: string) {
  return `data: ${data}\n\n`;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const sessionId = BigInt(id);

  const url = new URL(req.url);
  const cursorRaw = url.searchParams.get("cursor");
  let cursor = cursorRaw ? BigInt(cursorRaw) : 0n;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`event: ready\n${sse(JSON.stringify({ ok: true }))}`));

      // Simple polling stream (MVP). Replace with push/pubsub later.
      while (true) {
        const events = await prisma.event.findMany({
          where: { sessionId, sequence: { gt: cursor } },
          orderBy: [{ sequence: "asc" }],
          take: 200,
          select: { sequence: true, type: true, payload: true, agentId: true, createdAt: true },
        });

        for (const e of events) {
          cursor = e.sequence;
          controller.enqueue(
            encoder.encode(
              sse(
                JSON.stringify(e, (_k, v) =>
                  typeof v === "bigint" ? v.toString() : v
                )
              )
            )
          );
        }

        // Client disconnected?
        if (req.signal.aborted) break;

        await new Promise((r) => setTimeout(r, 1000));
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
