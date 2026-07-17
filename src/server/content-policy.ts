export const CONTENT_POLICY_VERSION = "original-or-authorized-v2";

export type ContentPolicySurface = "identifier" | "narrative" | "player-name";

export const IP_SCREENING_DISCLAIMER =
  "Automated screening found no obvious conflict in the declared sources. This is not legal clearance, a guarantee of noninfringement, or a determination of registrability.";

export const CONTENT_POLICY = Object.freeze({
  version: CONTENT_POLICY_VERSION,
  rule: "Submit only original material or material you are authorized to use.",
  terminology: "This system performs IP screening, not copyright or trademark clearance.",
  requiredBeforeUse: [
    "Screen campaign titles and main character names before storage",
    "Screen persistent or campaign-defining setting, faction, location, species, organization, and artifact names before first use",
    "Search both the USPTO federal trademark database and ordinary web/common-law use using exact and similar variants",
    "Record query variants, source references, findings, rights basis, and screening time",
  ],
  prohibited: [
    "Requests to copy or reproduce protected text verbatim",
    "Unauthorized adaptations, continuations, crossovers, or fan fiction based on protected works",
    "Use of third-party characters, settings, lore, dialogue, brands, or distinctive story elements without documented authorization",
    "Known franchise identifiers or confusingly similar variants presented as original material",
    "Requests to imitate a named creator's distinctive style or voice",
  ],
  allowed: [
    "Original characters, settings, rules, and prose after required high-visibility name screening",
    "Generic genres, themes, tropes, stock elements, and game mechanics",
    "Public-domain or properly licensed material with source-specific rights evidence",
  ],
  sourceTiers: {
    tier1: "Official records and actual rights documents: USPTO, copyright.gov, licenses, and written permissions",
    tier2: "Established legal analysis and reputable licensing indexes used only as supporting evidence",
    tier3: "Forums, wikis, social posts, and unsourced blogs; never sufficient evidence",
  },
  statuses: ["screening_evidence_recorded", "human_review_recorded", "rights_evidence_human_reviewed"],
  disclaimer: IP_SCREENING_DISCLAIMER,
});

const EXPLICIT_COPYING_PATTERNS: RegExp[] = [
  /\b(?:copy|quote|reproduce|transcribe)\b.{0,80}\b(?:verbatim|word[\s-]*for[\s-]*word|full text|entire text|exact passage)\b/i,
  /\b(?:verbatim|word[\s-]*for[\s-]*word|full text|entire text|exact passage)\b.{0,80}\b(?:book|novel|chapter|screenplay|script|lyrics?|poem|comic|game|film|movie|episode)\b/i,
  /\b(?:continue|rewrite|adapt|retell|recreate)\b.{0,100}\b(?:copyrighted|published|existing|someone else's|third[ -]party)\b.{0,40}\b(?:book|novel|story|series|film|movie|episode|game|campaign|world)\b/i,
  /\b(?:use|include|recreate)\b.{0,80}\b(?:copyrighted|proprietary|third[ -]party)\b.{0,40}\b(?:characters?|settings?|world|universe|lore|dialogue|story|brand)\b/i,
  /\b(?:fan[ -]?fiction|fanfic|unauthori[sz]ed (?:sequel|prequel|adaptation)|franchise crossover)\b/i,
  /\b(?:bypass|ignore|evade|hide|obfuscate)\b.{0,60}\b(?:copyright|trademark|licen[cs]e|rights?|content policy|ip screening)\b/i,
];

// This is a conservative platform exclusion list, not a declaration that every
// listed string is protected in every context. It catches high-confidence
// franchise references and verified collision incidents while structured
// screening handles identifiers that are not yet known to the server.
const PLATFORM_EXCLUDED_IDENTIFIERS = [
  "whisperwood",
  "barnacle boy",
  "spongebob squarepants",
  "mickey mouse",
  "harry potter",
  "hogwarts",
  "star wars",
  "darth vader",
  "luke skywalker",
  "pokemon",
  "pikachu",
  "dungeons and dragons",
  "d&d",
  "forgotten realms",
  "middle earth",
  "gandalf",
  "warhammer",
  "game of thrones",
  "westeros",
  "hyrule",
] as const;

const NAMED_CREATOR_STYLE_PATTERNS = [
  /\b(?:in|copy|mimic|imitate|match)\s+(?:the\s+)?(?:exact\s+)?(?:style|voice|prose)\s+of\s+[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)+/u,
  /\b(?:write|narrate|describe|sound|read)\b.{0,30}\b(?:like|as)\s+[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)+/u,
];

const IDENTIFIER_STOP_WORDS = new Set(["a", "an", "and", "at", "for", "in", "job", "of", "on", "the"]);

function configuredExcludedIdentifiers(): string[] {
  const configured = process.env.AQ_BLOCKED_IP_TERMS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  return [...PLATFORM_EXCLUDED_IDENTIFIERS, ...configured];
}

export function normalizePolicyText(value: string): string {
  return value
    .replace(/([\p{Ll}\d])([\p{Lu}])/gu, "$1 $2")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "")
    .replace(/&/gu, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ")
    .trim();
}

function editDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length]!;
}

function identifierCandidates(text: string): string[] {
  const words = text.split(" ").filter((word) => word && !IDENTIFIER_STOP_WORDS.has(word));
  const candidates = new Set<string>([words.join("")]);
  for (let start = 0; start < words.length; start += 1) {
    for (let width = 1; width <= Math.min(4, words.length - start); width += 1) {
      candidates.add(words.slice(start, start + width).join(""));
    }
  }
  return [...candidates].filter(Boolean);
}

function excludedIdentifierMatch(value: string, surface: ContentPolicySurface): { term: string; near: boolean } | null {
  // Agent display names and player-chosen character names are identity labels,
  // not platform-authored campaign content. Do not hard-block them against
  // the platform's franchise/exclusion list. Story text, campaign lexicon,
  // and persistent GM-authored names still use the stricter surfaces.
  if (surface === "player-name") return null;
  const text = normalizePolicyText(value);
  if (!text) return null;
  const padded = ` ${text} `;
  const candidates = surface === "identifier" ? identifierCandidates(text) : [];
  for (const rawTerm of configuredExcludedIdentifiers()) {
    const term = normalizePolicyText(rawTerm);
    if (!term) continue;
    if (padded.includes(` ${term} `)) return { term: rawTerm, near: false };
    if (surface !== "identifier") continue;
    const compactTerm = term.replace(/\s/gu, "");
    if (candidates.includes(compactTerm)) return { term: rawTerm, near: false };
    const threshold = compactTerm.length >= 12 ? 2 : compactTerm.length >= 7 ? 1 : 0;
    if (threshold && candidates.some((candidate) => Math.abs(candidate.length - compactTerm.length) <= threshold && editDistance(candidate, compactTerm) <= threshold)) {
      return { term: rawTerm, near: true };
    }
  }
  return null;
}

export function findContentPolicyViolation(value: string, surface: ContentPolicySurface = "narrative"): string | null {
  const text = value
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
  if (!text) return null;
  if (NAMED_CREATOR_STYLE_PATTERNS.some((pattern) => pattern.test(text))) return "named-creator style imitation request";
  if (EXPLICIT_COPYING_PATTERNS.some((pattern) => pattern.test(text))) return "explicit copying or unauthorized adaptation request";
  const excluded = excludedIdentifierMatch(text, surface);
  if (excluded) return `${excluded.near ? "confusingly similar variant of" : "known third-party or platform-excluded identifier"} \"${excluded.term}\"`;
  return null;
}

export function assertContentPolicy(value: string, label: string, surface: ContentPolicySurface = "narrative"): void {
  const violation = findContentPolicyViolation(value, surface);
  if (violation) {
    throw new Response(
      `${label} violates the ${CONTENT_POLICY_VERSION} IP policy: ${violation}. Use a new original identifier or route documented rights evidence through human review.`,
      { status: 422 },
    );
  }
}

export function assertJsonTextContentPolicy(value: unknown, label: string, depth = 0): void {
  if (depth > 8) throw new Response(`${label} is nested too deeply`, { status: 400 });
  if (typeof value === "string") {
    assertContentPolicy(value, label);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonTextContentPolicy(item, label, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      assertJsonTextContentPolicy(item, label, depth + 1);
    }
  }
}
