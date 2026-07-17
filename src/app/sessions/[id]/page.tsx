"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  buildChronicleBeats,
  buildTurns,
  deriveTableStatus,
  isChronicleNearBottom,
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
    case "scene":
      return "chronicle-beat--scene";
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

function Beat({ beat, compact = false, chat = false }: { beat: ChronicleBeat; compact?: boolean; chat?: boolean }) {
  const time = formatTime(beat.event.createdAt);

  if (beat.presentation === "marker") {
    return (
      <div className={`chronicle-marker ${chat ? "chronicle-marker--chat" : ""}`} aria-label={`${beat.eyebrow}: ${beat.title}`}>
        <span>{beat.title}</span>
        <time>{time ?? "Recorded"}</time>
      </div>
    );
  }

  return (
    <article className={`chronicle-beat ${compact ? "chronicle-beat--compact" : ""} ${chat ? "chronicle-beat--chat" : ""} ${toneClasses(beat.tone)}`}>
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
  const [campaign, setCampaign] = useState<{ name: string; description: string } | null>(null);
  const [hasUnseen, setHasUnseen] = useState(false);
  const [isAtLatest, setIsAtLatest] = useState(true);
  const chatViewportRef = useRef<HTMLDivElement>(null);
  const stickToLatestRef = useRef(true);
  const renderedBeatSequenceRef = useRef<string | null>(null);

  useEffect(() => {
    Promise.resolve(params).then(({ id }) => setSessionId(id));
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

    es.addEventListener("ready", (message) => {
      setStatus("live");
      try {
        const ready = JSON.parse((message as MessageEvent).data) as { campaign?: { name?: unknown; description?: unknown } };
        if (typeof ready.campaign?.name === "string" && typeof ready.campaign.description === "string") {
          setCampaign({ name: ready.campaign.name, description: ready.campaign.description });
        }
      } catch {
        // Older stream payloads remain compatible during a rolling deployment.
      }
    });
    es.onerror = () => setStatus("reconnecting");

    return () => es.close();
  }, [sessionId]);

  const beats = useMemo(() => buildChronicleBeats(events), [events]);
  const turns = useMemo(() => buildTurns(events), [events]);
  const openingScene = beats.find((beat) => beat.tone === "scene");
  const latestTurn = [...turns].reverse().find((turn) => turn.turnNumber > 0);
  const tableStatus = useMemo(() => deriveTableStatus(events), [events]);
  const latestBeatSequence = beats.at(-1)?.event.sequence ?? null;

  useEffect(() => {
    if (view !== "live" || beats.length === 0) return;
    const viewport = chatViewportRef.current;
    if (!viewport) return;

    const previousSequence = renderedBeatSequenceRef.current;
    const hasNewBeat = latestBeatSequence !== previousSequence;
    renderedBeatSequenceRef.current = latestBeatSequence;

    const frame = window.requestAnimationFrame(() => {
      if (!stickToLatestRef.current) {
        if (hasNewBeat) setHasUnseen(true);
        return;
      }
      viewport.scrollTop = viewport.scrollHeight;
      setIsAtLatest(true);
      setHasUnseen(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [beats.length, latestBeatSequence, view]);

  function handleChatScroll() {
    const viewport = chatViewportRef.current;
    if (!viewport) return;
    const atLatest = isChronicleNearBottom(viewport);
    stickToLatestRef.current = atLatest;
    setIsAtLatest(atLatest);
    if (atLatest) setHasUnseen(false);
  }

  function jumpToLatest() {
    const viewport = chatViewportRef.current;
    if (!viewport) return;
    stickToLatestRef.current = true;
    setIsAtLatest(true);
    setHasUnseen(false);
    viewport.scrollTop = viewport.scrollHeight;
  }

  function showLiveView() {
    stickToLatestRef.current = true;
    setIsAtLatest(true);
    setHasUnseen(false);
    setView("live");
  }

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
          <h1>{campaign?.name ?? "The Chronicle"}</h1>
          <p>{campaign?.description ?? "Follow the opening scene and every consequence as the adventure unfolds."}</p>
        </div>

        <div className="view-switcher" aria-label="Chronicle view">
          <button
            className={view === "live" ? "is-active" : ""}
            type="button"
            onClick={showLiveView}
          >
            Latest
          </button>
          <button
            className={view === "recap" ? "is-active" : ""}
            type="button"
            onClick={() => setView("recap")}
          >
            Turn recap
          </button>
        </div>
      </header>

      {view === "live" ? (
        <section className="session-layout">
          <div className="chronicle-chat">
            <div className="chronicle-chat__header">
              <div>
                <span className="kicker">Live chronicle</span>
                <h2>The story so far</h2>
              </div>
              <div className="chronicle-chat__header-meta">
                {latestTurn ? (
                  <div className="turn-pill">{latestTurn.roundNumber ? `Round ${latestTurn.roundNumber} · ` : ""}Turn {latestTurn.turnNumber}</div>
                ) : null}
                <span>{beats.length} {beats.length === 1 ? "entry" : "entries"}</span>
              </div>
            </div>

            <div className="chronicle-chat__body">
              <div className="chronicle-chat__top-fade" aria-hidden="true" />
              <div
                ref={chatViewportRef}
                className="chronicle-chat__viewport"
                onScroll={handleChatScroll}
                role="log"
                aria-live="polite"
                aria-relevant="additions"
                aria-label="Live campaign chronicle"
                tabIndex={0}
              >
                {beats.length ? (
                  <div className="chronicle-chat__messages">
                    {beats.map((beat) => (
                      <Beat key={beat.event.sequence} beat={beat} compact chat />
                    ))}
                  </div>
                ) : (
                  <div className="chronicle-chat__empty">
                    <h3>The candles are lit.</h3>
                    <p>Waiting for the first adventurer to make a move.</p>
                  </div>
                )}
              </div>

              {!isAtLatest ? (
                <button
                  className="chronicle-chat__latest"
                  type="button"
                  onClick={jumpToLatest}
                  aria-label={hasUnseen ? "New story beat. Return to the latest chronicle entry." : "Return to the latest chronicle entry."}
                >
                  {hasUnseen ? "New story beat" : "Back to latest"} ↓
                </button>
              ) : null}
            </div>

            <div className="chronicle-chat__footer">
              <span className="connection-state"><span className="live-dot" /> {status === "live" ? "Following live" : "Reconnecting"}</span>
              <span>Newest entries appear at the bottom</span>
            </div>
          </div>

          <aside className="table-state">
            <span className="kicker">At the table</span>
            <h2>Current scene</h2>
            <dl>
              <div>
                <dt>Setting</dt>
                <dd className="table-state__setting">
                  {openingScene?.body ?? campaign?.description ?? "Waiting for the Game Master to set the opening scene."}
                </dd>
              </div>
              <div>
                <dt>Progress</dt>
                <dd>{latestTurn ? `${latestTurn.roundNumber ? `Round ${latestTurn.roundNumber} · ` : ""}Turn ${latestTurn.turnNumber}` : "Opening"}</dd>
              </div>
              <div>
                <dt>Next action</dt>
                <dd>{tableStatus.label}</dd>
              </div>
              <div>
                <dt>Why play is paused</dt>
                <dd>{tableStatus.detail}</dd>
              </div>
              <div>
                <dt>Connection</dt>
                <dd className="connection-state"><span className="live-dot" /> {status === "live" ? "Following live" : "Reconnecting"}</dd>
              </div>
            </dl>
            <p className="table-state__note">The chronicle updates automatically. Agent actions still require the named agent to be awake and connected.</p>
          </aside>
        </section>
      ) : (
        <section className="recap-view">
          <div className="chronicle-list__header">
            <div>
              <span className="kicker">Catch up</span>
              <h2>Turn-by-turn recap</h2>
              <p>In story order, from the opening scene onward.</p>
            </div>
            <div>{turns.length} {turns.length === 1 ? "turn" : "turns"}</div>
          </div>

          {turns.length ? (
            <div className="recap-stack">
              {turns.map((turn, index) => (
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
