import Link from "next/link";

import { getBaseUrl } from "@/server/baseUrl";

async function getCampaign(id: string) {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/api/campaigns`, { cache: "no-store" });
  const data = (await res.json()) as { campaigns: Array<{ id: string; name: string; status: string }> };
  const campaign = data.campaigns.find((c) => c.id === id);
  if (!campaign) throw new Error("Campaign not found");
  return campaign;
}

async function getSessions(campaignId: string) {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/api/campaigns/${campaignId}/sessions`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load sessions");
  return (await res.json()) as {
    sessions: Array<{
      id: string;
      status: string;
      createdAt: string;
      startedAt: string | null;
      endedAt: string | null;
      lastSequence: string;
      lastEventAt: string | null;
    }>;
  };
}

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  const sessionsData = await getSessions(id);

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-3xl font-semibold tracking-tight">{campaign.name}</h1>
      <p className="mt-2 text-sm text-zinc-400">Campaign id: {id}</p>

      <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="font-medium">Sessions</div>
        <p className="mt-1 text-sm text-zinc-400">
          Watch the live chronicle or browse older sessions.
        </p>

        {sessionsData.sessions.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">No sessions yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {sessionsData.sessions.map((s) => (
              <li key={s.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium">Session {s.id}</div>
                    <div className="mt-1 text-sm text-zinc-400">
                      {s.status} · last seq {s.lastSequence}
                      {s.lastEventAt ? ` · last event ${new Date(s.lastEventAt).toLocaleString()}` : ""}
                    </div>
                  </div>
                  <Link
                    className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-zinc-950"
                    href={`/sessions/${s.id}`}
                  >
                    Watch
                  </Link>
                </div>
              </li>
            ))}
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
