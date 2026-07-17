export function parsePositiveBigInt(value: string): bigint | null {
  try {
    const id = BigInt(value);
    return id > 0n ? id : null;
  } catch {
    return null;
  }
}

export function parseNonNegativeBigInt(value: string): bigint | null {
  try {
    const id = BigInt(value);
    return id >= 0n ? id : null;
  } catch {
    return null;
  }
}
