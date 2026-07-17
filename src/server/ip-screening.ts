import { sha256Hex } from "./crypto.ts";
import {
  assertContentPolicy,
  CONTENT_POLICY_VERSION,
  IP_SCREENING_DISCLAIMER,
  normalizePolicyText,
} from "./content-policy.ts";

export const RIGHTS_BASES = ["original", "licensed", "public-domain", "permission", "mixed"] as const;
export type RightsBasis = (typeof RIGHTS_BASES)[number];

export const IP_SCREENING_SOURCE_KINDS = [
  "uspto-federal",
  "copyright-office",
  "license-document",
  "permission-record",
  "web-search",
  "legal-analysis",
  "creative-commons",
] as const;
export type IpScreeningSourceKind = (typeof IP_SCREENING_SOURCE_KINDS)[number];

export const IP_SCREENING_RESULTS = ["no-obvious-conflict", "possible-conflict", "rights-evidence-found"] as const;
export type IpScreeningResult = (typeof IP_SCREENING_RESULTS)[number];

export type IpScreeningSource = {
  kind: IpScreeningSourceKind;
  tier: 1 | 2;
  query: string;
  reference: string;
  result: IpScreeningResult;
};

export const HUMAN_REVIEW_DECISIONS = ["no-obvious-conflict", "rights-basis-confirmed"] as const;
export type HumanReviewDecision = (typeof HUMAN_REVIEW_DECISIONS)[number];

export type HumanReviewAttestation = {
  attested: true;
  reviewedAt: string;
  reviewer: string;
  decision: HumanReviewDecision;
  notes: string;
};

export const IP_SCREENING_STATUSES = [
  "screening_evidence_recorded",
  "human_review_recorded",
  "rights_evidence_human_reviewed",
] as const;
export type IpScreeningStatus = (typeof IP_SCREENING_STATUSES)[number];

export type IpScreeningEvidence = {
  policyVersion: typeof CONTENT_POLICY_VERSION;
  status: IpScreeningStatus;
  rightsBasis: RightsBasis;
  subjectHash: string;
  checkedAt: string;
  queries: string[];
  sources: IpScreeningSource[];
  notes: string;
  humanReview: HumanReviewAttestation | null;
  disclaimer: typeof IP_SCREENING_DISCLAIMER;
};

export const NAMED_ELEMENT_KINDS = ["setting", "location", "faction", "organization", "species", "deity", "artifact", "other"] as const;
export type NamedElementKind = (typeof NAMED_ELEMENT_KINDS)[number];

export type ScreenedNamedElement = {
  name: string;
  kind: NamedElementKind;
  rightsBasis: RightsBasis;
  ipScreening: IpScreeningEvidence;
};

const SOURCE_TIERS: Record<IpScreeningSourceKind, 1 | 2> = {
  "uspto-federal": 1,
  "copyright-office": 1,
  "license-document": 1,
  "permission-record": 1,
  "web-search": 2,
  "legal-analysis": 2,
  "creative-commons": 2,
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Response(`${label} must be an object`, { status: 400 });
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(input: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(input).some((key) => !allowed.includes(key))) {
    throw new Response(`${label} contains unknown fields`, { status: 400 });
  }
}

export function parseRightsBasis(value: unknown, label = "rightsBasis"): RightsBasis {
  const basis = String(value ?? "");
  if (!(RIGHTS_BASES as readonly string[]).includes(basis)) {
    throw new Response(`${label} must be ${RIGHTS_BASES.join("|")}`, { status: 400 });
  }
  return basis as RightsBasis;
}

function parseReference(value: unknown, kind: IpScreeningSourceKind, label: string): string {
  const reference = String(value ?? "").trim();
  if (!reference || reference.length > 800) throw new Response(`${label} must be 1-800 characters`, { status: 400 });
  if (/^sha256:[a-f0-9]{64}$/u.test(reference)) {
    if (kind !== "license-document" && kind !== "permission-record") {
      throw new Response(`${label} evidence hashes are allowed only for license or permission records`, { status: 400 });
    }
    return reference;
  }
  let url: URL;
  try { url = new URL(reference); }
  catch { throw new Response(`${label} must be an HTTPS URL or sha256 evidence hash`, { status: 400 }); }
  if (url.protocol !== "https:") throw new Response(`${label} must use HTTPS`, { status: 400 });
  const host = url.hostname.toLocaleLowerCase("en-US");
  if (kind === "uspto-federal" && host !== "uspto.gov" && !host.endsWith(".uspto.gov")) {
    throw new Response(`${label} for uspto-federal must reference uspto.gov`, { status: 400 });
  }
  if (kind === "copyright-office" && host !== "copyright.gov" && !host.endsWith(".copyright.gov")) {
    throw new Response(`${label} for copyright-office must reference copyright.gov`, { status: 400 });
  }
  return url.toString();
}

function parseSources(value: unknown, queries: string[], label: string): IpScreeningSource[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 12) {
    throw new Response(`${label} must contain 2-12 source records`, { status: 400 });
  }
  const normalizedQueries = new Set(queries.map(normalizePolicyText));
  return value.map((raw, index) => {
    const source = asRecord(raw, `${label}[${index}]`);
    assertOnlyKeys(source, ["kind", "query", "reference", "result"], `${label}[${index}]`);
    const kind = String(source.kind ?? "") as IpScreeningSourceKind;
    if (!(IP_SCREENING_SOURCE_KINDS as readonly string[]).includes(kind)) {
      throw new Response(`${label}[${index}].kind must be ${IP_SCREENING_SOURCE_KINDS.join("|")}`, { status: 400 });
    }
    const query = String(source.query ?? "").trim();
    if (!query || query.length > 300 || !normalizedQueries.has(normalizePolicyText(query))) {
      throw new Response(`${label}[${index}].query must exactly match one declared query`, { status: 400 });
    }
    const result = String(source.result ?? "") as IpScreeningResult;
    if (!(IP_SCREENING_RESULTS as readonly string[]).includes(result)) {
      throw new Response(`${label}[${index}].result must be ${IP_SCREENING_RESULTS.join("|")}`, { status: 400 });
    }
    return {
      kind,
      tier: SOURCE_TIERS[kind],
      query,
      reference: parseReference(source.reference, kind, `${label}[${index}].reference`),
      result,
    };
  });
}

function parseHumanReview(value: unknown, checkedAt: Date, now: number, label: string): HumanReviewAttestation | null {
  if (value == null) return null;
  const review = asRecord(value, label);
  assertOnlyKeys(review, ["attested", "reviewedAt", "reviewer", "decision", "notes"], label);
  if (review.attested !== true) throw new Response(`${label}.attested must be true`, { status: 400 });
  const reviewedAt = new Date(String(review.reviewedAt ?? ""));
  if (!Number.isFinite(reviewedAt.getTime())) throw new Response(`${label}.reviewedAt must be an ISO timestamp`, { status: 400 });
  if (reviewedAt.getTime() < checkedAt.getTime() || reviewedAt.getTime() > now + 5 * 60_000 || reviewedAt.getTime() < now - 30 * 24 * 60 * 60_000) {
    throw new Response(`${label}.reviewedAt must follow the search, be within the last 30 days, and not be in the future`, { status: 400 });
  }
  const reviewer = String(review.reviewer ?? "").trim();
  if (reviewer.length < 2 || reviewer.length > 160) throw new Response(`${label}.reviewer must be 2-160 characters`, { status: 400 });
  const decision = String(review.decision ?? "") as HumanReviewDecision;
  if (!(HUMAN_REVIEW_DECISIONS as readonly string[]).includes(decision)) {
    throw new Response(`${label}.decision must be ${HUMAN_REVIEW_DECISIONS.join("|")}`, { status: 400 });
  }
  const notes = String(review.notes ?? "").trim();
  if (notes.length < 20 || notes.length > 1200) throw new Response(`${label}.notes must be 20-1200 characters`, { status: 400 });
  return { attested: true, reviewedAt: reviewedAt.toISOString(), reviewer, decision, notes };
}

export function parseIpScreeningEvidence(
  value: unknown,
  input: { subject: string; rightsBasis: RightsBasis; label: string; now?: number },
): IpScreeningEvidence {
  const screening = asRecord(value, input.label);
  assertOnlyKeys(screening, ["checkedAt", "queries", "sources", "notes", "humanReview"], input.label);
  const now = input.now ?? Date.now();
  const checkedAt = new Date(String(screening.checkedAt ?? ""));
  if (!Number.isFinite(checkedAt.getTime())) throw new Response(`${input.label}.checkedAt must be an ISO timestamp`, { status: 400 });
  if (checkedAt.getTime() > now + 5 * 60_000 || checkedAt.getTime() < now - 30 * 24 * 60 * 60_000) {
    throw new Response(`${input.label}.checkedAt must be within the last 30 days and not in the future`, { status: 400 });
  }
  if (!Array.isArray(screening.queries) || screening.queries.length < 2 || screening.queries.length > 8) {
    throw new Response(`${input.label}.queries must contain 2-8 search variants`, { status: 400 });
  }
  const queries = [...new Set(screening.queries.map((raw) => String(raw).trim()))];
  if (queries.length < 2 || queries.some((query) => !query || query.length > 300)) {
    throw new Response(`${input.label}.queries must contain at least two distinct queries of 1-300 characters`, { status: 400 });
  }
  const normalizedSubject = normalizePolicyText(input.subject);
  if (!normalizedSubject || !queries.some((query) => normalizePolicyText(query).includes(normalizedSubject))) {
    throw new Response(`${input.label}.queries must include the exact proposed identifier`, { status: 400 });
  }
  const notes = String(screening.notes ?? "").trim();
  if (notes.length < 20 || notes.length > 1200) {
    throw new Response(`${input.label}.notes must summarize findings in 20-1200 characters`, { status: 400 });
  }
  const sources = parseSources(screening.sources, queries, `${input.label}.sources`);
  const uspto = sources.some((source) => source.kind === "uspto-federal" && source.result === "no-obvious-conflict");
  const web = sources.some((source) => source.kind === "web-search" && source.result === "no-obvious-conflict");
  if (!uspto || !web) {
    throw new Response(`${input.label} requires no-obvious-conflict records from both uspto-federal and web-search`, { status: 400 });
  }

  const humanReview = parseHumanReview(screening.humanReview, checkedAt, now, `${input.label}.humanReview`);
  const possibleConflict = sources.some((source) => source.result === "possible-conflict");
  if (possibleConflict) {
    const requiredDecision = input.rightsBasis === "original" ? "no-obvious-conflict" : "rights-basis-confirmed";
    if (!humanReview || humanReview.decision !== requiredDecision) {
      throw new Response(`${input.label} found a possible conflict; humanReview.decision=${requiredDecision} is required before publication`, { status: 409 });
    }
  }

  const evidenceKind: Partial<Record<RightsBasis, IpScreeningSourceKind>> = {
    licensed: "license-document",
    permission: "permission-record",
    "public-domain": "copyright-office",
  };
  const requiredEvidenceKind = evidenceKind[input.rightsBasis];
  if (requiredEvidenceKind && !sources.some((source) => source.kind === requiredEvidenceKind && source.result === "rights-evidence-found")) {
    throw new Response(`${input.label} with rightsBasis=${input.rightsBasis} requires ${requiredEvidenceKind} rights evidence`, { status: 400 });
  }
  if (input.rightsBasis === "mixed" && !sources.some((source) =>
    ["license-document", "permission-record", "copyright-office"].includes(source.kind) && source.result === "rights-evidence-found")) {
    throw new Response(`${input.label} with rightsBasis=mixed requires at least one Tier 1 rights-evidence record`, { status: 400 });
  }
  if (input.rightsBasis === "public-domain" && !sources.some((source) =>
    source.kind === "legal-analysis" && source.result === "rights-evidence-found")) {
    throw new Response(`${input.label} with rightsBasis=public-domain requires a legal-analysis record in addition to a Copyright Office search`, { status: 400 });
  }
  if (input.rightsBasis !== "original" && (!humanReview || humanReview.decision !== "rights-basis-confirmed")) {
    throw new Response(`${input.label} with rightsBasis=${input.rightsBasis} requires a documented humanReview with decision=rights-basis-confirmed`, { status: 409 });
  }

  const status: IpScreeningStatus = input.rightsBasis !== "original"
    ? "rights_evidence_human_reviewed"
    : humanReview
      ? "human_review_recorded"
      : "screening_evidence_recorded";

  return {
    policyVersion: CONTENT_POLICY_VERSION,
    status,
    rightsBasis: input.rightsBasis,
    subjectHash: sha256Hex(normalizedSubject),
    checkedAt: checkedAt.toISOString(),
    queries,
    sources,
    notes,
    humanReview,
    disclaimer: IP_SCREENING_DISCLAIMER,
  };
}

export function assertStoredIpScreeningEvidence(
  value: unknown,
  input: { subject: string; label: string; now?: number },
): IpScreeningEvidence {
  const stored = asRecord(value, input.label);
  assertOnlyKeys(stored, [
    "policyVersion", "status", "rightsBasis", "subjectHash", "checkedAt", "queries", "sources", "notes", "humanReview", "disclaimer",
  ], input.label);
  const rightsBasis = parseRightsBasis(stored.rightsBasis, `${input.label}.rightsBasis`);
  const sources = Array.isArray(stored.sources)
    ? stored.sources.map((raw, index) => {
      const source = asRecord(raw, `${input.label}.sources[${index}]`);
      return { kind: source.kind, query: source.query, reference: source.reference, result: source.result };
    })
    : stored.sources;
  const reparsed = parseIpScreeningEvidence({
    checkedAt: stored.checkedAt,
    queries: stored.queries,
    sources,
    notes: stored.notes,
    humanReview: stored.humanReview,
  }, { subject: input.subject, rightsBasis, label: input.label, now: input.now });
  if (
    stored.policyVersion !== reparsed.policyVersion
    || stored.status !== reparsed.status
    || stored.subjectHash !== reparsed.subjectHash
    || stored.disclaimer !== reparsed.disclaimer
  ) {
    throw new Response(`${input.label} is not bound to the current policy and proposed identifier`, { status: 422 });
  }
  return reparsed;
}

export function parseScreenedNamedElements(value: unknown, label: string): ScreenedNamedElement[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 24) throw new Response(`${label} must be an array of at most 24 elements`, { status: 400 });
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const item = asRecord(raw, `${label}[${index}]`);
    assertOnlyKeys(item, ["name", "kind", "rightsBasis", "ipScreening"], `${label}[${index}]`);
    const name = String(item.name ?? "").trim();
    if (!name || name.length > 160) throw new Response(`${label}[${index}].name must be 1-160 characters`, { status: 400 });
    assertContentPolicy(name, `${label}[${index}].name`, "identifier");
    const normalizedName = normalizePolicyText(name);
    if (seen.has(normalizedName)) throw new Response(`${label} contains duplicate names`, { status: 400 });
    seen.add(normalizedName);
    const kind = String(item.kind ?? "") as NamedElementKind;
    if (!(NAMED_ELEMENT_KINDS as readonly string[]).includes(kind)) {
      throw new Response(`${label}[${index}].kind must be ${NAMED_ELEMENT_KINDS.join("|")}`, { status: 400 });
    }
    const rightsBasis = parseRightsBasis(item.rightsBasis, `${label}[${index}].rightsBasis`);
    return {
      name,
      kind,
      rightsBasis,
      ipScreening: parseIpScreeningEvidence(item.ipScreening, { subject: name, rightsBasis, label: `${label}[${index}].ipScreening` }),
    };
  });
}

export function assertStoredScreenedNamedElements(value: unknown, label: string): ScreenedNamedElement[] {
  if (!Array.isArray(value) || value.length > 24) throw new Response(`${label} must be an array of at most 24 elements`, { status: 400 });
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const item = asRecord(raw, `${label}[${index}]`);
    assertOnlyKeys(item, ["name", "kind", "rightsBasis", "ipScreening"], `${label}[${index}]`);
    const name = String(item.name ?? "").trim();
    if (!name || name.length > 160) throw new Response(`${label}[${index}].name must be 1-160 characters`, { status: 400 });
    assertContentPolicy(name, `${label}[${index}].name`, "identifier");
    const normalizedName = normalizePolicyText(name);
    if (seen.has(normalizedName)) throw new Response(`${label} contains duplicate names`, { status: 400 });
    seen.add(normalizedName);
    const kind = String(item.kind ?? "") as NamedElementKind;
    if (!(NAMED_ELEMENT_KINDS as readonly string[]).includes(kind)) {
      throw new Response(`${label}[${index}].kind must be ${NAMED_ELEMENT_KINDS.join("|")}`, { status: 400 });
    }
    const rightsBasis = parseRightsBasis(item.rightsBasis, `${label}[${index}].rightsBasis`);
    const ipScreening = assertStoredIpScreeningEvidence(item.ipScreening, { subject: name, label: `${label}[${index}].ipScreening` });
    if (ipScreening.rightsBasis !== rightsBasis) throw new Response(`${label}[${index}] rightsBasis does not match its screening record`, { status: 422 });
    return { name, kind, rightsBasis, ipScreening };
  });
}
