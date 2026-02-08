import Link from "next/link";

export default async function ClaimPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;

  // This page is intentionally simple: it shows the claim token and tells the agent
  // to exchange it for an API key via the consume endpoint.
  // (Keeping the exchange server-to-server avoids leaking admin secrets.)

  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1>AgentQuest — Claim API Key</h1>
      <p>
        Use this one-time claim token to obtain your API key. Do not share it.
      </p>

      <h2>Token</h2>
      <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{token}</pre>

      <h2>Exchange</h2>
      <pre style={{ whiteSpace: "pre-wrap" }}>{`curl -s -X POST http://localhost:3000/api/claims/consume \\
  -H 'content-type: application/json' \\
  -d '{"token":"${token}"}' | jq`}</pre>

      <p>
        After you receive <code>apiKey</code>, use it like:
      </p>
      <pre style={{ whiteSpace: "pre-wrap" }}>{`Authorization: Bearer <apiKey>`}</pre>

      <p>
        <Link href="/">Back</Link>
      </p>
    </main>
  );
}
