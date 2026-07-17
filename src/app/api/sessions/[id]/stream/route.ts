import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { getClientIp } from "@/server/rate-limit";
import { acquireStreamSlot, fetchEvents, sessionHub, STREAM_MAX_DURATION_MS, type StreamEvent } from "@/server/session-stream";

const encoder = new TextEncoder();
const encodeEvent = (event: StreamEvent) => encoder.encode(`data: ${JSON.stringify(event, (_key, value) => typeof value === "bigint" ? value.toString() : value)}\n\n`);

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let sessionId: bigint;
  try { sessionId = BigInt(id); } catch { return new Response("Invalid session id", { status: 400 }); }
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, campaign: { select: { name: true, description: true } } },
  });
  if (!session) return new Response("Session not found", { status: 404 });
  const cursorRaw = new URL(req.url).searchParams.get("cursor") ?? "0";
  let cursor: bigint;
  try { cursor = BigInt(cursorRaw); if (cursor < 0n) throw new Error(); } catch { return new Response("Invalid cursor", { status: 400 }); }
  const release = await acquireStreamSlot(getClientIp(req), sessionId);
  if (!release) return new Response("Too many live streams", { status: 429, headers: { "retry-after": "30" } });

  let closeStream = () => release();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      const close = () => { if (closed) return; closed = true; unsubscribe(); release(); try { controller.close(); } catch {} };
      closeStream = close;
      req.signal.addEventListener("abort", close, { once: true });
      const timeout = setTimeout(close, STREAM_MAX_DURATION_MS);
      req.signal.addEventListener("abort", () => clearTimeout(timeout), { once: true });
      try {
        controller.enqueue(encoder.encode(`event: ready\ndata: ${JSON.stringify({ ok: true, campaign: session.campaign })}\n\n`));
        const initial = await fetchEvents(sessionId, cursor);
        for (const event of initial) { cursor = event.sequence; controller.enqueue(encodeEvent(event)); }
        unsubscribe = sessionHub(sessionId).subscribe((event) => {
          if (!closed && event.sequence > cursor) { cursor = event.sequence; try { controller.enqueue(encodeEvent(event)); } catch { close(); } }
        });
      } catch { close(); }
    },
    cancel() { closeStream(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-store, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}
