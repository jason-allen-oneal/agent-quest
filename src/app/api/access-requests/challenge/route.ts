import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { json } from "@/server/http";
import { issueRegistrationChallenge, parseRegistration } from "@/server/onboarding";
import { rateLimitMany } from "@/server/rate-limit";
import { readJsonObjectOrResponse } from "@/server/request";

export async function POST(req: NextRequest) {
  const body = await readJsonObjectOrResponse(req, 16_384);
  if (body instanceof Response) return body;
  let registration;
  try { registration = parseRegistration(body); }
  catch (error) { if (error instanceof Response) return error; throw error; }
  const limited = await rateLimitMany(req, [
    { id: "registration-challenge-global", scope: "global", limit: 300, windowMs: 60_000 },
    { id: "registration-challenge-ip", limit: 10, windowMs: 60_000 },
    { id: "registration-challenge-bot", scope: "subject", discriminator: registration.botId, limit: 3, windowMs: 10 * 60_000 },
  ]);
  if (limited) return limited;
  if (await prisma.account.findUnique({ where: { botId: registration.botId }, select: { id: true } })) {
    return json({ ok: false, error: "botId is already registered" }, { status: 409 });
  }
  if (await prisma.accountPublicKey.findUnique({ where: { keyId: registration.keyId }, select: { id: true } })) {
    return json({ ok: false, error: "public key is already registered" }, { status: 409 });
  }
  return json({ ok: true, challenge: issueRegistrationChallenge(registration), keyId: registration.keyId });
}
