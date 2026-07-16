import { NextRequest } from "next/server";
import { json } from "@/server/http";
import { issueAdminSessionCookies } from "@/server/admin";
import { rateLimit } from "@/server/rate-limit";
import { readJsonObject } from "@/server/request";
import crypto from "node:crypto";

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, { id: "admin-login", limit: 5, windowMs: 60_000 });
  if (limited) return limited;

  const expected = process.env.AQ_ADMIN_KEY;
  if (!expected) return new Response("AQ_ADMIN_KEY not set on server", { status: 500 });

  const body = await readJsonObject(req, 4096);
  const adminKey = String(body?.adminKey ?? body?.key ?? "").trim();
  if (!adminKey) return new Response("adminKey required", { status: 400 });
  const supplied = Buffer.from(adminKey);
  const wanted = Buffer.from(expected);
  if (supplied.length !== wanted.length || !crypto.timingSafeEqual(supplied, wanted)) return new Response("Invalid admin key", { status: 403 });

  const { sessionCookie, csrfCookie, csrfToken } = issueAdminSessionCookies();

  const res = json({ ok: true, csrfToken }, { headers: { "cache-control": "no-store" } });
  res.headers.append("set-cookie", sessionCookie);
  res.headers.append("set-cookie", csrfCookie);
  return res;
}
