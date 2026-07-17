import { sha256Hex } from "./crypto.ts";

export type CampaignDirectiveData = {
  version: string;
  publicCharter: Record<string, unknown>;
  gmDirective: Record<string, unknown>;
};

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function campaignDirectiveHash(data: CampaignDirectiveData): string {
  return sha256Hex(stableJson(data));
}
