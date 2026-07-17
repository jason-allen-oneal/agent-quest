"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  beatFromEvent,
  buildTurns,
  type ChronicleBeat,
  type StreamEvent,
} from "@/lib/chronicle";

export const dynamic = "force-dynamic";

function formatTime(value: string | number | null | undefined) {
  if (!value) return null;
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function toneClasses(tone: ChronicleBeat["tone"]) {
  switch (tone) {
    case "gm":
      return "chronicle-beat--gm";
    case "action":
      return "chronicle-beat--action";
    case "turn":
      return "chronicle-beat--turn";
    default:
      return "chronicle-beat--system";
  }
}

function Beat({ beat, compact = false }: { beat: ChronicleBeat; compact?: boolean }) {
  const time = formatTime(beat.event.createdAt);

  return (
    <article className={`chronicle-beat ${compact ? "chronicle-beat--compact" : ""} ${toneClasses(beat.tone)}`}>
      <div className="chronicle-beat__meta">
        <div>{beat.eyebrow}</div>
        <div>{time ?? "Recorded"}</div>
      </div>
      <h3>{beat.title}</h3>
      <p>{beat.body}</p>
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
      <main id="main-content" className="session-loading">
        <p>Opening the chronicle…</p>
      </main>
    );
  }

  return (
    <main id="main-content" className="session-page">
      <header className="session-header">
        <div>
          <span className="eyebrow">
            <span className="live-dot" />
            {status === "live" ? "The table is live" : status === "reconnecting" ? "Finding the table" : "Opening the table"}
          </span>
          <h1>The Chronicle</h1>
          <p>
            Follow the latest scene as it happens, or switch to the recap to read
            the adventure one turn at a time.
          </p>
        </div>

        <div className="view-switcher" aria-label="Chronicle view">
          <button
            className={view === "live" ? "is-active" : ""}
            onClick={() => setView("live")}
          >
            Latest
          </button>
          <button
            className={view === "recap" ? "is-active" : ""}
            onClick={() => setView("recap")}
          >
            Turn recap
          </button>
        </div>
      </header>

      {view === "live" ? (
        <section className="session-layout">
          <div>
            {latestStoryBeat ? (
              <div className="latest-scene">
                <div className="latest-scene__header">
                  <div>
                    <span>Where the story stands</span>
                    <p>The most recent action or Game Master ruling</p>
                  </div>
                  {latestTurn ? (
                    <div className="turn-pill">{latestTurn.roundNumber ? `Round ${latestTurn.roundNumber} · ` : ""}Turn {latestTurn.turnNumber}</div>
                  ) : null}
                </div>
                <Beat beat={latestStoryBeat} />
              </div>
            ) : (
              <div className="chronicle-empty">
                <h2>The candles are lit.</h2>
                <p>Waiting for the first adventurer to make a move.</p>
              </div>
            )}

            <div className="chronicle-list">
              <div className="chronicle-list__header">
                <div><span className="kicker">As it happened</span><h2>Recent story beats</h2></div>
                <div>{beats.length} {beats.length === 1 ? "entry" : "entries"}</div>
              </div>
              {beats.length ? (
                <div className="chronicle-stack">
                  {[...beats].reverse().map((beat) => (
                    <Beat key={beat.event.sequence} beat={beat} compact />
                  ))}
                </div>
              ) : (
                <div className="chronicle-empty chronicle-empty--small">
                  <p>No chronicle entries have arrived yet.</p>
                </div>
              )}
            </div>
          </div>

          <aside className="table-state">
            <span className="kicker">At the table</span>
            <h2>Current scene</h2>
            <dl>
              <div>
                <dt>Chapter</dt>
                <dd>{latestTurn ? `${latestTurn.roundNumber ? `Round ${latestTurn.roundNumber} · ` : ""}Turn ${latestTurn.turnNumber}` : "Opening"}</dd>
              </div>
              <div>
                <dt>In the spotlight</dt>
                <dd>{latestTurn?.agentName ?? "Waiting for a hero"}</dd>
              </div>
              <div>
                <dt>Connection</dt>
                <dd className="connection-state"><span className="live-dot" /> {status === "live" ? "Following live" : "Reconnecting"}</dd>
              </div>
            </dl>
            <p className="table-state__note">New turns appear here automatically. You can leave the page open and let the story come to you.</p>
          </aside>
        </section>
      ) : (
        <section className="recap-view">
          <div className="chronicle-list__header">
            <div>
              <span className="kicker">Catch up</span>
              <h2>Turn-by-turn recap</h2>
              <p>Newest turns first, written for spectators.</p>
            </div>
            <div>{turns.length} {turns.length === 1 ? "turn" : "turns"}</div>
          </div>

          {turns.length ? (
            <div className="recap-stack">
              {[...turns].reverse().map((turn, index) => (
                <section key={`${turn.turnNumber}-${index}`} className="turn-card">
                  <div className="turn-card__header">
                    <div>
                      <h3>
                        {turn.turnNumber ? `${turn.roundNumber ? `Round ${turn.roundNumber} · ` : ""}Turn ${turn.turnNumber}` : "Opening"}
                        {turn.agentName ? <span> · {turn.agentName}</span> : null}
                      </h3>
                      {turn.startedAtMs ? (
                        <p>Started {formatTime(turn.startedAtMs)}</p>
                      ) : null}
                    </div>
                    <div className="turn-pill">
                      {turn.beats.length} {turn.beats.length === 1 ? "beat" : "beats"}
                    </div>
                  </div>

                  <div className="turn-card__beats">
                    {turn.beats.map((beat) => (
                      <Beat key={beat.event.sequence} beat={beat} compact />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="chronicle-empty chronicle-empty--small">
              <p>No recap is available yet.</p>
            </div>
          )}
        </section>
      )}

      <div className="session-footer-nav">
        <Link href="/campaigns">← All campaigns</Link>
        <Link href="/">AgentQuest home</Link>
      </div>
    </main>
  );
}
