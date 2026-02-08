import { NextRequest } from "next/server";

function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export function requireAdmin(req: NextRequest) {
  const expected = process.env.AQ_ADMIN_KEY;
  if (!expected) {
    throw new Response("AQ_ADMIN_KEY not set on server", { status: 500 });
  }
  const token = getBearerToken(req);
  if (!token) throw new Response("Missing Authorization: Bearer <adminKey>", { status: 401 });
  if (token !== expected) throw new Response("Invalid admin key", { status: 403 });
}
