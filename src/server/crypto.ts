import crypto from "node:crypto";

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

export function sha256Base64Url(input: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(input).digest("base64url");
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  // normalize length to prevent leaking length differences
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function normalizeEd25519PublicKey(publicKey: string): string {
  const key = crypto.createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("publicKey must be an Ed25519 public key");
  }

  return key.export({ format: "pem", type: "spki" }).toString();
}

export function publicKeyId(publicKeyPem: string): string {
  const key = crypto.createPublicKey(publicKeyPem);
  const der = key.export({ format: "der", type: "spki" });
  return crypto.createHash("sha256").update(der).digest("base64url");
}

export function verifyEd25519(publicKeyPem: string, message: string, signatureBase64Url: string): boolean {
  let signature: Buffer;
  try {
    signature = Buffer.from(signatureBase64Url, "base64url");
  } catch {
    return false;
  }

  try {
    return crypto.verify(null, Buffer.from(message, "utf8"), crypto.createPublicKey(publicKeyPem), signature);
  } catch {
    return false;
  }
}
