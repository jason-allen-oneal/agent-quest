import crypto from "node:crypto";
import { sha256Hex } from "./crypto.ts";

type ClaimTransaction = {
  apiKeyClaim: { updateMany(args: unknown): Promise<{ count: number }> };
  apiKey: { create(args: unknown): Promise<unknown> };
};

export async function consumeApiKeyClaim(
  tx: ClaimTransaction,
  claim: { id: bigint; accountId: bigint },
  now = new Date(),
  makeKey = () => crypto.randomBytes(24).toString("base64url"),
) {
  const consumed = await tx.apiKeyClaim.updateMany({
    where: { id: claim.id, claimedAt: null, expiresAt: { gt: now } },
    data: { claimedAt: now },
  });
  if (consumed.count !== 1) throw new Response("Invalid or already claimed", { status: 409 });
  const apiKey = makeKey();
  await tx.apiKey.create({ data: { accountId: claim.accountId, hash: sha256Hex(apiKey) }, select: { id: true } });
  return { apiKey };
}
