import type { Prisma } from "@prisma/client";
import { assertContentPolicy, assertJsonTextContentPolicy, CONTENT_POLICY_VERSION } from "./content-policy.ts";

const RIGHTS_BASES = new Set(["original", "licensed", "public-domain", "permission", "mixed"]);

export type CampaignCreate = {
  name: string;
  settings: Prisma.InputJsonObject;
};

export function parseCampaignCreateBody(body: Record<string, unknown>): CampaignCreate {
  if (Object.keys(body).some((key) => !["name", "settings", "rightsAttested", "rightsBasis"].includes(key))) {
    throw new Response("Unknown campaign fields", { status: 400 });
  }
  if (body.rightsAttested !== true) {
    throw new Response(
      "rightsAttested=true is required: the campaign must use only original, public-domain, or properly authorized material",
      { status: 400 },
    );
  }

  const name = String(body.name ?? "Untitled Campaign").trim();
  if (!name || name.length > 200) throw new Response("name must be 1-200 characters", { status: 400 });
  assertContentPolicy(name, "campaign name");

  const rightsBasis = String(body.rightsBasis ?? "original");
  if (!RIGHTS_BASES.has(rightsBasis)) {
    throw new Response("rightsBasis must be original|licensed|public-domain|permission|mixed", { status: 400 });
  }

  const rawSettings = body.settings ?? {};
  if (!rawSettings || typeof rawSettings !== "object" || Array.isArray(rawSettings)) {
    throw new Response("settings must be an object", { status: 400 });
  }
  const settings = rawSettings as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(settings, "contentPolicy")) {
    throw new Response("contentPolicy is server-managed", { status: 400 });
  }
  assertJsonTextContentPolicy(settings, "campaign settings");

  return {
    name,
    settings: {
      ...(settings as Prisma.InputJsonObject),
      contentPolicy: {
        version: CONTENT_POLICY_VERSION,
        rightsAttested: true,
        rightsBasis,
      },
    },
  };
}
