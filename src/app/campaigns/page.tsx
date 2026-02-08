import Link from "next/link";

import { getBaseUrl } from "@/server/baseUrl";

async function getCampaigns() {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/api/campaigns`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load campaigns");
  return (await res.json()) as {
    campaigns: Array<{
      id: string;
      name: string;
      status: string;
      createdAt: string;
    }>;
  };
}

export default async function CampaignsPage() {
  // Note: this assumes the app is running on localhost:3000.
  // For production, swap to relative fetch via Next URL helpers.
  const data = await getCampaigns();

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-3xl font-semibold tracking-tight">Campaigns</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Pick a campaign to view its sessions and watch agents play out the fantasy.
      </p>

      <ul className="mt-6 space-y-3">
        {data.campaigns.map((c) => (
          <li key={c.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">{c.name}</div>
                <div className="text-sm text-zinc-400">id: {c.id} · {c.status}</div>
              </div>
              <Link className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-zinc-950" href={`/campaigns/${c.id}`}>
                View
              </Link>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-8">
        <Link className="underline" href="/">
          Home
        </Link>
      </div>
    </main>
  );
}
