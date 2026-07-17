import type { Prisma } from "@prisma/client";
import { assertContentPolicy, assertJsonTextContentPolicy, CONTENT_POLICY_VERSION } from "./content-policy.ts";
import {
  parseIpScreeningEvidence,
  parseRightsBasis,
  parseScreenedNamedElements,
  type IpScreeningEvidence,
  type ScreenedNamedElement,
} from "./ip-screening.ts";

export type CampaignCreate = {
  data: {
    name: string;
    description: string;
    minPlayers: number;
    maxPlayers: number;
    autoStart: boolean;
    rightsStatus: string;
    contentPolicyVersion: string;
    settings: Prisma.InputJsonObject;
  };
  review: IpScreeningEvidence;
  namedElements: ScreenedNamedElement[];
};

export function parseCampaignCreateBody(body: Record<string, unknown>): CampaignCreate {
  if (Object.keys(body).some((key) => !["name", "description", "minPlayers", "maxPlayers", "autoStart", "settings", "rightsAttested", "rightsBasis", "ipScreening", "namedElements"].includes(key))) {
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
  assertContentPolicy(name, "campaign name", "identifier");

  const description = String(body.description ?? "").trim();
  if (description.length < 20 || description.length > 2000) {
    throw new Response("description must be 20-2000 characters", { status: 400 });
  }
  assertContentPolicy(description, "campaign description");

  const minPlayers = body.minPlayers ?? 2;
  const maxPlayers = body.maxPlayers ?? 6;
  if (!Number.isInteger(minPlayers) || Number(minPlayers) < 1 || Number(minPlayers) > 20) {
    throw new Response("minPlayers must be an integer from 1-20", { status: 400 });
  }
  if (!Number.isInteger(maxPlayers) || Number(maxPlayers) < Number(minPlayers) || Number(maxPlayers) > 20) {
    throw new Response("maxPlayers must be an integer from minPlayers through 20", { status: 400 });
  }
  if (body.autoStart != null && typeof body.autoStart !== "boolean") {
    throw new Response("autoStart must be a boolean", { status: 400 });
  }

  const rightsBasis = parseRightsBasis(body.rightsBasis);
  const ipScreening = parseIpScreeningEvidence(body.ipScreening, {
    subject: name,
    rightsBasis,
    label: "ipScreening",
  });
  const namedElements = parseScreenedNamedElements(body.namedElements, "namedElements");

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
    data: {
      name,
      description,
      minPlayers: Number(minPlayers),
      maxPlayers: Number(maxPlayers),
      autoStart: body.autoStart !== false,
      rightsStatus: ipScreening.status,
      contentPolicyVersion: CONTENT_POLICY_VERSION,
      settings: {
        ...(settings as Prisma.InputJsonObject),
        contentPolicy: {
          version: CONTENT_POLICY_VERSION,
          rightsAttested: true,
          rightsBasis,
          ipScreening,
          namedElements,
        },
      },
    },
    review: ipScreening,
    namedElements,
  };
}
