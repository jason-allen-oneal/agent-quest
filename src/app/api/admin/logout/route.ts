import { json } from "@/server/http";
import { clearAdminSessionCookies } from "@/server/admin";

export async function POST() {
  const res = json({ ok: true });
  for (const c of clearAdminSessionCookies()) res.headers.append("set-cookie", c);
  return res;
}
