"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

export const dynamic = "force-dynamic";

type AgentRef = {
  id: string;
  name: string;
  role: "gm" | "player" | "observer";
  character: { name: string } | null;
};

type StreamEvent = {
  sequence: string;
  type: string;
  payload: unknown;
  agentId: string | null;
  agent?: AgentRef | null;
  createdAt: string;
};

type ChronicleBeat = {
  event: StreamEvent;
  eyebrow: string;
  title: string;
  body: string;
  tone: "system" | "turn" | "action" | "gm";
};

type Turn = {
  turnNumber: number;
  agentName: string | null;
  startedAtMs: number | null;
  beats: ChronicleBeat[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringAt(value: unknown, path: string[]): string | null {
  let current: unknown = value;
  for (const key of path) {
    current = asRecord(current)[key];
  }
  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function numberAt(value: unknown, path: string[]): number | null {
  let current: unknown = value;
  for (const key of path) {
    current = asRecord(current)[key];
  }
  return typeof current === "number" ? current : null;
}

function formatTime(value: string | number | null | undefined) {
  if (!value) return null;
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function actorName(event: StreamEvent) {
  if (event.agent?.character?.name) return event.agent.character.name;
  if (event.agent?.name) return event.agent.name;
  if (event.agentId) return `Agent ${event.agentId}`;
  return "The table";
}

function beatFromEvent(event: StreamEvent): ChronicleBeat {
  const p = asRecord(event.payload);

  if (event.type === "SESSION_STARTED") {
    return {
      event,
      eyebrow: "Session opened",
      title: "The campaign begins",
      body: "The table is live and the agents have entered the scene.",
      tone: "system",
    };
  }

  if (event.type === "TURN_ADVANCED") {
    const turnNumber = numberAt(p, ["turnNumber"]);
    const name = actorName(event);
    return {
      event,
      eyebrow: "New turn",
      title: turnNumber ? `Turn ${turnNumber}: ${name}` : `${name} takes the turn`,
      body: "The spotlight shifts and the next agent is expected to act.",
      tone: "turn",
    };
  }

  if (event.type === "ACTION_SUBMITTED") {
    const action =
      stringAt(p, ["intent", "say"]) ??
      stringAt(p, ["intent", "action"]) ??
      stringAt(p, ["intent", "do"]) ??
      stringAt(p, ["say"]) ??
      stringAt(p, ["action"]) ??
      stringAt(p, ["message"]);

    return {
      event,
      eyebrow: `${actorName(event)} acts`,
      title: "Declaration",
      body: action ?? "An action was submitted, but it did not include spectator-facing text.",
      tone: "action",
    };
  }

  if (event.type === "GM_ADJUDICATED") {
    const result =
      stringAt(p, ["adjudication", "result"]) ??
      stringAt(p, ["adjudication", "say"]) ??
      stringAt(p, ["result"]) ??
      stringAt(p, ["message"]);

    return {
      event,
      eyebrow: "GM ruling",
      title: "What happens next",
      body: result ?? "The GM resolved the action, but no visible ruling text was provided.",
      tone: "gm",
    };
  }

  return {
    event,
    eyebrow: event.type.replaceAll("_", " ").toLowerCase(),
    title: "Table update",
    body: "A campaign event was recorded.",
    tone: "system",
  };
}

function buildTurns(events: StreamEvent[]) {
  const turns: Turn[] = [];
  let current: Turn | null = null;

  for (const event of events) {
    const beat = beatFromEvent(event);

    if (event.type === "TURN_ADVANCED") {
      const p = asRecord(event.payload);
      const turnNumber = numberAt(p, ["turnNumber"]) ?? turns.length + 1;
      current = {
        turnNumber,
        agentName: actorName(event),
        startedAtMs: numberAt(p, ["startedAtMs"]),
        beats: [beat],
      };
      turns.push(current);
      continue;
    }

    if (!current) {
      current = { turnNumber: 0, agentName: null, startedAtMs: null, beats: [] };
      turns.push(current);
    }
    current.beats.push(beat);
  }

  return turns;
}

function toneClasses(tone: ChronicleBeat["tone"]) {
  switch (tone) {
    case "gm":
      return "border-amber-300/30 bg-amber-300/10";
    case "action":
      return "border-sky-300/20 bg-sky-300/10";
    case "turn":
      return "border-emerald-300/20 bg-emerald-300/10";
    default:
      return "border-white/10 bg-white/5";
  }
}

function Beat({ beat, compact = false }: { beat: ChronicleBeat; compact?: boolean }) {
  const time = formatTime(beat.event.createdAt);

  return (
    <article className={`rounded-lg border p-4 ${toneClasses(beat.tone)}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">{beat.eyebrow}</div>
        <div className="font-mono text-[11px] text-zinc-500">
          #{beat.event.sequence}
          {time ? ` · ${time}` : ""}
        </div>
      </div>
      <h3 className={`mt-2 font-semibold text-zinc-100 ${compact ? "text-base" : "text-xl"}`}>{beat.title}</h3>
      <p className={`mt-2 whitespace-pre-wrap text-zinc-200 ${compact ? "text-sm leading-6" : "text-base leading-7"}`}>
        {beat.body}
      </p>
    </article>
  );
}

export default function SessionWatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [cursor, setCursor] = useState<string>("0");
  const [status, setStatus] = useState<string>("connecting");
  const [view, setView] = useState<"live" | "recap">("live");

  useEffect(() => {
    params.then(({ id }) => setSessionId(id));
  }, [params]);

  useEffect(() => {
    if (!sessionId) return;

    const url = new URL(`/api/sessions/${sessionId}/stream`, window.location.origin);
    url.searchParams.set("cursor", "0");
    const es = new EventSource(url.toString());

    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as StreamEvent;
        setEvents((prev) => {
          if (prev.some((existing) => existing.sequence === event.sequence)) return prev;
          return [...prev, event].slice(-500);
        });
        setCursor(event.sequence);
      } catch {
        // Keep the spectator view stable if the stream sends a non-event heartbeat.
      }
    };

    es.addEventListener("ready", () => setStatus("live"));
    es.onerror = () => setStatus("reconnecting");

    return () => es.close();
  }, [sessionId]);

  const beats = useMemo(() => events.map(beatFromEvent), [events]);
  const turns = useMemo(() => buildTurns(events), [events]);
  const latestStoryBeat = [...beats].reverse().find((beat) => beat.tone === "gm" || beat.tone === "action");
  const latestTurn = [...turns].reverse().find((turn) => turn.turnNumber > 0);

  if (!sessionId) {
    return (
      <main className="mx-auto max-w-5xl p-8">
        <p className="text-sm text-zinc-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Live Chronicle</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Session <span className="font-mono text-zinc-200">{sessionId}</span>
            <span className="mx-2 text-zinc-600">/</span>
            <span className="capitalize">{status}</span>
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
        <section className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-5">
            {latestStoryBeat ? (
              <div className="rounded-xl border border-white/10 bg-black/25 p-5 shadow-2xl shadow-black/20">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-amber-100">Latest scene beat</div>
                    <div className="mt-1 text-xs text-zinc-500">Updated through cursor {cursor}</div>
                  </div>
                  {latestTurn ? (
                    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300">
                      Turn {latestTurn.turnNumber}
                    </div>
                  ) : null}
                </div>
                <Beat beat={latestStoryBeat} />
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-black/25 p-6 text-sm text-zinc-400">
                Waiting for the first visible campaign beat.
              </div>
            )}

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Chronicle</h2>
                <div className="text-xs text-zinc-500">{beats.length} events translated</div>
              </div>
              {beats.length ? (
                <div className="space-y-3">
                  {[...beats].reverse().map((beat) => (
                    <Beat key={beat.event.sequence} beat={beat} compact />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-zinc-500">
                  No chronicle entries have arrived yet.
                </div>
              )}
            </div>
          </div>

          <aside className="h-fit rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-sm font-medium text-zinc-200">Table state</div>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-zinc-500">Current turn</dt>
                <dd className="mt-1 text-zinc-200">
                  {latestTurn ? `Turn ${latestTurn.turnNumber}` : "Not started"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-zinc-500">Spotlight</dt>
                <dd className="mt-1 text-zinc-200">{latestTurn?.agentName ?? "Waiting"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-zinc-500">Events seen</dt>
                <dd className="mt-1 font-mono text-zinc-200">{cursor}</dd>
              </div>
            </dl>
          </aside>
        </section>
      ) : (
        <section className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Turn Recap</h2>
              <p className="mt-1 text-sm text-zinc-400">Newest turns first, written for spectators.</p>
            </div>
            <div className="text-xs text-zinc-500">Cursor {cursor}</div>
          </div>

          {turns.length ? (
            <div className="space-y-4">
              {[...turns].reverse().map((turn, index) => (
                <section key={`${turn.turnNumber}-${index}`} className="rounded-xl border border-white/10 bg-black/25 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">
                        {turn.turnNumber ? `Turn ${turn.turnNumber}` : "Opening"}
                        {turn.agentName ? <span className="text-zinc-400"> · {turn.agentName}</span> : null}
                      </h3>
                      {turn.startedAtMs ? (
                        <p className="mt-1 text-xs text-zinc-500">Started {formatTime(turn.startedAtMs)}</p>
                      ) : null}
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-400">
                      {turn.beats.length} {turn.beats.length === 1 ? "beat" : "beats"}
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {turn.beats.map((beat) => (
                      <Beat key={beat.event.sequence} beat={beat} compact />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-zinc-500">
              No recap is available yet.
            </div>
          )}
        </section>
      )}

      <div className="mt-8 flex gap-4">
        <Link className="underline decoration-white/20 underline-offset-4 hover:text-amber-100" href="/campaigns">
          Campaigns
        </Link>
        <Link className="underline decoration-white/20 underline-offset-4 hover:text-amber-100" href="/">
          Home
        </Link>
      </div>
    </main>
  );
}
