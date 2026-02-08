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
  const [view, setView] = useState<"live" | "recap">("live");

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
    <main className="mx-auto max-w-5xl p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Live Chronicle</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Session <span className="font-mono text-zinc-200">{sessionId}</span> · stream status: {status}
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-1 text-sm">
          <button
            className={`rounded-md px-3 py-1 ${view === "live" ? "bg-white text-zinc-950" : "text-zinc-200"}`}
            onClick={() => setView("live")}
          >
            Live
          </button>
          <button
            className={`rounded-md px-3 py-1 ${view === "recap" ? "bg-white text-zinc-950" : "text-zinc-200"}`}
            onClick={() => setView("recap")}
          >
            Recap
          </button>
        </div>
      </div>

      {view === "live" ? (
        <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-zinc-400">
              Latest cursor: <span className="font-mono text-zinc-200">{cursor}</span>
            </div>
            <div className="text-xs text-zinc-500">Raw event feed</div>
          </div>
          <pre className="mt-4 max-h-[60vh] overflow-auto rounded-lg bg-black/30 p-3 text-xs leading-5 text-zinc-200">
            {events
              .map((e) => `${e.sequence}  ${e.type}\n${JSON.stringify(e.payload)}\n`)
              .join("\n")}
          </pre>
        </div>
      ) : (
        <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-zinc-400">Turn recap (best-effort)</div>
            <div className="text-xs text-zinc-500">Grouped by TURN_ADVANCED</div>
          </div>

          <div className="mt-4 space-y-3">
            {(() => {
              type Turn = {
                turnNumber: number;
                agentId: string | null;
                startedAtMs: number | null;
                events: StreamEvent[];
              };

              const turns: Turn[] = [];
              let current: Turn | null = null;

              for (const e of events) {
                if (e.type === "TURN_ADVANCED") {
                  const p = (e.payload ?? {}) as Record<string, unknown>;
                  const tn = typeof p.turnNumber === "number" ? (p.turnNumber as number) : turns.length + 1;
                  const aid = typeof p.agentId === "string" ? (p.agentId as string) : null;
                  const startedAtMs = typeof p.startedAtMs === "number" ? (p.startedAtMs as number) : null;
                  current = { turnNumber: tn, agentId: aid, startedAtMs, events: [e] };
                  turns.push(current);
                } else {
                  if (!current) {
                    current = { turnNumber: 0, agentId: null, startedAtMs: null, events: [] };
                    turns.push(current);
                  }
                  current.events.push(e);
                }
              }

              const last = turns.slice(-12).reverse();

              if (last.length === 0) {
                return <div className="text-sm text-zinc-500">No events yet.</div>;
              }

              return last.map((t, idx) => (
                <div key={`${t.turnNumber}-${idx}`} className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">
                      Turn {t.turnNumber || "?"}{" "}
                      {t.agentId ? (
                        <span className="text-sm text-zinc-400">
                          · agent <span className="font-mono text-zinc-200">{t.agentId}</span>
                        </span>
                      ) : null}
                    </div>
                    {t.startedAtMs ? (
                      <div className="text-xs text-zinc-500">{new Date(t.startedAtMs).toLocaleString()}</div>
                    ) : null}
                  </div>

                  <div className="mt-3 space-y-2">
                    {t.events
                      .filter((e) => e.type !== "TURN_ADVANCED")
                      .slice(-25)
                      .map((e) => (
                        <div key={e.sequence} className="rounded-lg bg-black/30 p-2">
                          <div className="text-xs text-zinc-400">
                            <span className="font-mono text-zinc-200">{e.sequence}</span> · {e.type}
                          </div>
                          <div className="mt-1 text-xs text-zinc-300">
                            <pre className="whitespace-pre-wrap break-words">{JSON.stringify(e.payload, null, 2)}</pre>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

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
