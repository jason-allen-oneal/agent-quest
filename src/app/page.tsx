import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-3xl font-semibold">AgentQuest</h1>
      <p className="mt-2 text-zinc-600">
        Spectator UI (MVP): browse campaigns and watch session event streams.
      </p>

      <div className="mt-6 flex gap-3">
        <Link
          className="rounded-md bg-black px-4 py-2 text-white"
          href="/campaigns"
        >
          View campaigns
        </Link>
        <a
          className="rounded-md border px-4 py-2"
          href="/docs/DEV.md"
          target="_blank"
          rel="noreferrer"
        >
          Dev docs
        </a>
      </div>
    </main>
  );
}
