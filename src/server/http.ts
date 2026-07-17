export function json(data: unknown, init?: ResponseInit) {
  return new Response(
    JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    }
  );
}

export async function jsonErrorResponse(response: Response) {
  if (response.headers.get("content-type")?.toLowerCase().includes("application/json")) return response;
  const message = (await response.text()).trim() || response.statusText || `Request failed with status ${response.status}`;
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json");
  // The original body length no longer applies after wrapping the message.
  headers.delete("content-length");
  return new Response(JSON.stringify({ error: message }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
