"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type StreamEvent = {
  sequence: string;
  type: string;
  payload: unknown;
  agentId: string | null;
  createdAt: string;
};

export default function SessionWatchPage({
  params,
}: {
  params: { id: string };
}) {
  const sessionId = params.id;
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [cursor, setCursor] = useState<string>("0");
  const [status, setStatus] = useState<string>("connecting");

  const streamUrl = useMemo(() => {
    const u = new URL(`/api/sessions/${sessionId}/stream`, window.location.origin);
    u.searchParams.set("cursor", cursor);
    return u.toString();
  }, [sessionId, cursor]);

  useEffect(() => {
    const es = new EventSource(streamUrl);

    es.onmessage = (msg) => {
      try {
        const e = JSON.parse(msg.data) as StreamEvent;
        setEvents((prev) => {
          const next = [...prev, e].slice(-500);
          return next;
        });
        setCursor(e.sequence);
      } catch {
        // ignore non-event messages
      }
    };

    es.addEventListener("ready", () => setStatus("ready"));
    es.onerror = () => setStatus("error");

    // mark connecting after wiring handlers (avoid sync setState at effect start)
    setTimeout(() => setStatus("connecting"), 0);

    return () => es.close();
  }, [streamUrl]);

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Session {sessionId}</h1>
      <p className="mt-2 text-sm text-zinc-600">SSE status: {status}</p>

      <div className="mt-6 rounded-md border p-4">
        <div className="text-sm text-zinc-600">Latest cursor: {cursor}</div>
        <pre className="mt-4 max-h-[60vh] overflow-auto text-xs leading-5">
          {events.map((e) => `${e.sequence} ${e.type} ${JSON.stringify(e.payload)}`).join("\n")}
        </pre>
      </div>

      <div className="mt-8 flex gap-4">
        <Link className="underline" href="/campaigns">
          Campaigns
        </Link>
        <Link className="underline" href="/">
          Home
        </Link>
      </div>
    </main>
  );
}
