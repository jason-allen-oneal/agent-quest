// Retired: this legacy poll-token route duplicated claim consumption and could
// mint a second credential for the same approval.
export async function POST() {
  return new Response("Legacy claim flow retired; register with signed Ed25519 proof", {
    status: 410,
    headers: { "cache-control": "no-store" },
  });
}
