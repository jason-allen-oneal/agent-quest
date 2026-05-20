import Link from "next/link";
import { prisma } from "@/server/db";
import { notFound } from "next/navigation";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaignId = BigInt(id);

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, name: true, status: true },
  });
  if (!campaign) notFound();

  const sessions = await prisma.session.findMany({
    where: { campaignId },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, campaignId: true, status: true, createdAt: true, startedAt: true, endedAt: true },
    take: 200,
  });

  const lastBySession = await prisma.event.groupBy({
    by: ["sessionId"],
    where: { campaignId },
    _max: { sequence: true, createdAt: true },
  });

  const lastMap = new Map(
    lastBySession.map((r) => [
      r.sessionId.toString(),
      { lastSequence: r._max.sequence?.toString() ?? "0", lastEventAt: r._max.createdAt?.toISOString() ?? null },
    ])
  );

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-3xl font-semibold tracking-tight">{campaign.name}</h1>
      <p className="mt-2 text-sm text-zinc-400">Campaign id: {id}</p>

      <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="font-medium">Sessions</div>
        <p className="mt-1 text-sm text-zinc-400">
          Watch the live chronicle or browse older sessions.
        </p>

        {sessions.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">No sessions yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {sessions.map((s) => {
              const extra = lastMap.get(s.id.toString());
              return (
                <li key={s.id.toString()} className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-medium">Session {s.id.toString()}</div>
                      <div className="mt-1 text-sm text-zinc-400">
                        {s.status} · last seq {extra?.lastSequence ?? "0"}
                        {extra?.lastEventAt ? ` · last event ${new Date(extra.lastEventAt).toLocaleString()}` : ""}
                      </div>
                    </div>
                    <Link
                      className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-zinc-950"
                      href={`/sessions/${s.id.toString()}`}
                    >
                      Watch
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-4 text-xs text-zinc-500">
          Tip: sessions stream from an append-only event log.
        </p>
      </div>

      <div className="mt-8">
        <Link className="underline" href="/campaigns">
          Back
        </Link>
      </div>
    </main>
  );
}
