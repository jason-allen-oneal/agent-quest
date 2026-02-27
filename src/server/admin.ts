import crypto from "node:crypto";
import { NextRequest } from "next/server";

const ADMIN_SESSION_COOKIE = "aq_admin_session";
const ADMIN_CSRF_COOKIE = "aq_admin_csrf";

function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function b64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function hmacHex(secret: string, data: string): string {
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

function timingSafeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

type SessionPayload = {
  sid: string;
  iat: number;
  exp: number;
};

export function issueAdminSessionCookies(): { sessionCookie: string; csrfCookie: string; csrfToken: string } {
  const secret = process.env.AQ_ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("AQ_ADMIN_SESSION_SECRET not set");

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 60 * 60 * 12; // 12h
  const payload: SessionPayload = { sid: crypto.randomBytes(24).toString("base64url"), iat, exp };

  const body = b64urlJson(payload);
  const sig = hmacHex(secret, body);
  const token = `${body}.${sig}`;

  const csrfToken = crypto.randomBytes(24).toString("base64url");

  // HttpOnly session; JS-readable CSRF token.
  const sessionCookie = `${ADMIN_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Secure`;
  const csrfCookie = `${ADMIN_CSRF_COOKIE}=${csrfToken}; Path=/; SameSite=Strict; Secure`;

  return { sessionCookie, csrfCookie, csrfToken };
}

function getCookie(req: NextRequest, name: string): string | null {
  return req.cookies.get(name)?.value ?? null;
}

export function verifyAdminSession(req: NextRequest): boolean {
  const secret = process.env.AQ_ADMIN_SESSION_SECRET;
  if (!secret) throw new Response("AQ_ADMIN_SESSION_SECRET not set on server", { status: 500 });

  const token = getCookie(req, ADMIN_SESSION_COOKIE);
  if (!token) return false;

  const [body, sig] = token.split(".");
  if (!body || !sig) return false;
  const expected = hmacHex(secret, body);
  if (!timingSafeEq(sig, expected)) return false;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return false;
  }
  if (!payload?.exp || typeof payload.exp !== "number") return false;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) return false;

  return true;
}

function requireCsrf(req: NextRequest) {
  const csrfCookie = getCookie(req, ADMIN_CSRF_COOKIE);
  const csrfHeader = req.headers.get("x-csrf-token") ?? req.headers.get("X-CSRF-Token");
  if (!csrfCookie || !csrfHeader) throw new Response("Missing CSRF token", { status: 403 });
  if (!timingSafeEq(csrfCookie, csrfHeader)) throw new Response("Invalid CSRF token", { status: 403 });
}

export function requireAdmin(req: NextRequest, opts?: { csrf?: boolean }) {
  // Preferred: session cookies.
  const ok = verifyAdminSession(req);
  if (ok) {
    if (opts?.csrf && req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      requireCsrf(req);
    }
    return;
  }

  // Back-compat: allow Bearer AQ_ADMIN_KEY for server-to-server calls.
  const expected = process.env.AQ_ADMIN_KEY;
  if (!expected) {
    throw new Response("AQ_ADMIN_KEY not set on server", { status: 500 });
  }
  const token = getBearerToken(req);
  if (!token) throw new Response("Missing Authorization: Bearer <adminKey>", { status: 401 });
  if (token !== expected) throw new Response("Invalid admin key", { status: 403 });
}

export function clearAdminSessionCookies(): string[] {
  // Expire cookies.
  const expired = "Expires=Thu, 01 Jan 1970 00:00:00 GMT";
  return [
    `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Secure; ${expired}`,
    `${ADMIN_CSRF_COOKIE}=; Path=/; SameSite=Strict; Secure; ${expired}`,
  ];
}

export function getAdminCsrfToken(req: NextRequest): string | null {
  return getCookie(req, ADMIN_CSRF_COOKIE);
}
