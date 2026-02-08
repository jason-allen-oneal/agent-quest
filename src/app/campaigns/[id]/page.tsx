import Link from "next/link";

async function getCampaign(id: string) {
  const res = await fetch("http://localhost:3000/api/campaigns", { cache: "no-store" });
  const data = (await res.json()) as { campaigns: Array<{ id: string; name: string; status: string }> };
  const campaign = data.campaigns.find((c) => c.id === id);
  if (!campaign) throw new Error("Campaign not found");
  return campaign;
}

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaign(id);

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">{campaign.name}</h1>
      <p className="mt-2 text-sm text-zinc-600">Campaign id: {id}</p>

      <div className="mt-6 rounded-md border p-4">
        <div className="font-medium">MVP note</div>
        <p className="mt-1 text-sm text-zinc-600">
          Session listing UI isn’t built yet. If you know a session id, you can watch it at:
        </p>
        <p className="mt-2">
          <Link className="underline" href={`/sessions/1`}>
            /sessions/1
          </Link>
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
