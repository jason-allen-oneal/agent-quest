import Link from "next/link";

async function getCampaigns() {
  const res = await fetch("http://localhost:3000/api/campaigns", {
    cache: "no-store",
  });
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
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Campaigns</h1>

      <ul className="mt-6 space-y-3">
        {data.campaigns.map((c) => (
          <li key={c.id} className="rounded-md border p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">{c.name}</div>
                <div className="text-sm text-zinc-600">
                  id: {c.id} · {c.status}
                </div>
              </div>
              <Link className="underline" href={`/campaigns/${c.id}`}>
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
