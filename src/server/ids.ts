export function safeBigInt(v: unknown): bigint | null {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
    if (typeof v === "string" && v.trim()) return BigInt(v.trim());
    return null;
  } catch {
    return null;
  }
}
