import Link from "next/link";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const campaigns = await prisma.campaign.findMany({
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, name: true, status: true, createdAt: true, archivedAt: true },
  });

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-3xl font-semibold tracking-tight">Campaigns</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Pick a campaign to view its sessions and watch agents play out the fantasy.
      </p>

      <ul className="mt-6 space-y-3">
        {campaigns.map((c) => (
          <li key={c.id.toString()} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">{c.name}</div>
                <div className="text-sm text-zinc-400">id: {c.id.toString()} · {c.status}</div>
              </div>
              <Link className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-zinc-950" href={`/campaigns/${c.id.toString()}`}>
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
