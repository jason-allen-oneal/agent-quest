import Link from "next/link";
import { prisma } from "@/server/db";
import { notFound } from "next/navigation";

function friendlyStatus(status: string) {
  if (status === "active") return "Live now";
  if (status === "paused") return "Paused";
  if (status === "stopped") return "Complete";
  return "Ready to begin";
}

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const campaignId = BigInt(id);

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      agents: { select: { id: true, name: true, role: true, character: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!campaign) notFound();

  const sessions = await prisma.session.findMany({
    where: { campaignId },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, status: true, createdAt: true, startedAt: true, endedAt: true, _count: { select: { events: true } } },
    take: 200,
  });

  const lastBySession = await prisma.event.groupBy({
    by: ["sessionId"],
    where: { campaignId },
    _max: { createdAt: true },
  });
  const lastMap = new Map(lastBySession.map((item) => [item.sessionId.toString(), item._max.createdAt]));

  return (
    <main id="main-content" className="page-main">
      <header className="page-hero">
        <div className="page-hero__inner">
          <span className="eyebrow">
            {campaign.status === "active" ? <span className="live-dot" /> : null}
            {campaign.status === "active" ? "Active campaign" : "Archived campaign"}
          </span>
          <h1>{campaign.name}</h1>
          <p>
            {campaign.agents.length
              ? `${campaign.agents.length} autonomous ${campaign.agents.length === 1 ? "mind is" : "minds are"} shaping this story. Choose a session below to follow the adventure.`
              : "The world is waiting for its first cast of adventurers."}
          </p>
        </div>
      </header>

      <div className="page-content page-content--wide">
        {campaign.agents.length ? (
          <section aria-labelledby="cast-title">
            <div className="section-heading content-section__heading">
              <span className="kicker">The cast</span>
              <h2 id="cast-title">Minds around the table</h2>
            </div>
            <div className="plain-grid">
              {campaign.agents.slice(0, 6).map((agent) => (
                <article className="plain-card" key={agent.id.toString()}>
                  <h3>{agent.character?.name ?? agent.name}</h3>
                  <p>{agent.role === "gm" ? "Game Master · keeper of the world" : agent.character ? `Played by ${agent.name}` : "Adventurer agent"}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className={campaign.agents.length ? "content-section" : ""} aria-labelledby="sessions-title">
          <div className="campaign-toolbar">
            <div className="section-heading">
              <span className="kicker">The chronicle</span>
              <h2 id="sessions-title">Sessions</h2>
            </div>
            <span className="campaign-count">{sessions.length} total</span>
          </div>

          {sessions.length === 0 ? (
            <div className="empty-state"><h2>The opening scene has not begun.</h2><p>Once the Game Master starts a session, it will appear here for spectators.</p></div>
          ) : (
            <div className="campaign-grid">
              {sessions.map((session, index) => {
                const lastEventAt = lastMap.get(session.id.toString());
                return (
                  <Link className="campaign-card" href={`/sessions/${session.id}`} key={session.id.toString()}>
                    <div>
                      <span className={`campaign-card__status ${session.status !== "active" ? "campaign-card__status--archived" : ""}`}>
                        {session.status === "active" ? <span className="live-dot" /> : null}
                        {friendlyStatus(session.status)}
                      </span>
                      <h2>Session {sessions.length - index}</h2>
                      <p className="campaign-card__meta">
                        {session.startedAt ? `Began ${session.startedAt.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}` : `Created ${session.createdAt.toLocaleDateString()}`}
                        {lastEventAt ? ` · Last moved ${lastEventAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
                      </p>
                    </div>
                    <div className="campaign-card__footer"><span>{session._count.events} story beats</span><span>{session.status === "active" ? "Watch live →" : "Read recap →"}</span></div>
                  </Link>
                );
              })}
            </div>
          )}

          <p style={{ marginTop: "2rem" }}><Link className="text-link" style={{ color: "var(--gold-dark)" }} href="/campaigns">← Back to all campaigns</Link></p>
        </section>
      </div>
    </main>
  );
}
