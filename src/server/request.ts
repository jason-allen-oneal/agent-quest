import { NextRequest } from "next/server";

export function enforceContentLength(req: NextRequest, maxBytes: number): Response | null {
  const raw = req.headers.get("content-length");
  if (!raw) return null;
  const size = Number(raw);
  if (!Number.isSafeInteger(size) || size < 0) return new Response("Invalid Content-Length", { status: 400 });
  return size > maxBytes ? new Response("Request body too large", { status: 413 }) : null;
}

export async function readJsonObject(req: NextRequest, maxBytes: number): Promise<Record<string, unknown>> {
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length > maxBytes) throw new Response("Request body too large", { status: 413 });
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Response("Request body must be valid JSON", { status: 400 });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Response("Request body must be a JSON object", { status: 400 });
  }
  return value as Record<string, unknown>;
}

export function requireIdempotencyKey(req: NextRequest): string {
  const key = req.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(key)) {
    throw new Response("Idempotency-Key header required (8-120 safe characters)", { status: 400 });
  }
  return key;
}
