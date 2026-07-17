export const CONTENT_POLICY_VERSION = "original-or-authorized-v1";

export const CONTENT_POLICY = Object.freeze({
  version: CONTENT_POLICY_VERSION,
  rule: "Submit only original material or material you are authorized to use.",
  prohibited: [
    "Requests to copy or reproduce protected text verbatim",
    "Unauthorized adaptations or continuations of existing protected stories",
    "Use of third-party characters, settings, lore, dialogue, or distinctive story elements without permission",
    "Requests to imitate a named creator's distinctive style or voice",
  ],
  allowed: [
    "Original characters, settings, rules, and prose",
    "Generic genres, themes, tropes, and game mechanics",
    "Public-domain or properly licensed material when the campaign creator has verified the rights",
  ],
});

const EXPLICIT_COPYING_PATTERNS: RegExp[] = [
  /\b(?:copy|quote|reproduce|transcribe)\b.{0,80}\b(?:verbatim|word[\s-]*for[\s-]*word|full text|entire text|exact passage)\b/i,
  /\b(?:verbatim|word[\s-]*for[\s-]*word|full text|entire text|exact passage)\b.{0,80}\b(?:book|novel|chapter|screenplay|script|lyrics?|poem|comic|game|film|movie|episode)\b/i,
  /\b(?:continue|rewrite|adapt|retell|recreate)\b.{0,100}\b(?:copyrighted|published|existing)\b.{0,40}\b(?:book|novel|story|series|film|movie|episode|game|campaign)\b/i,
  /\b(?:use|include|recreate)\b.{0,80}\b(?:copyrighted|proprietary)\b.{0,40}\b(?:characters?|settings?|world|universe|lore|dialogue|story)\b/i,
  /\b(?:bypass|ignore|evade)\b.{0,60}\b(?:copyright|licen[cs]e|rights?|content policy)\b/i,
];

// A named-creator style request is not itself a reliable infringement test, but it
// is a poor input for an original-fiction platform. Generic genre/style requests
// such as "gothic horror" remain allowed.
const NAMED_CREATOR_STYLE = /\b(?:in|copy|mimic|imitate|match)\s+(?:the\s+)?(?:exact\s+)?(?:style|voice)\s+of\s+[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)+/u;

function normalized(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function findContentPolicyViolation(value: string): string | null {
  const text = normalized(value);
  if (!text) return null;
  if (NAMED_CREATOR_STYLE.test(text)) return "named-creator style imitation request";
  if (EXPLICIT_COPYING_PATTERNS.some((pattern) => pattern.test(text))) return "explicit copying or unauthorized adaptation request";
  return null;
}

export function assertContentPolicy(value: string, label: string): void {
  const violation = findContentPolicyViolation(value);
  if (violation) {
    throw new Response(
      `${label} violates the ${CONTENT_POLICY_VERSION} content policy: ${violation}. Use original, public-domain, or properly licensed material.`,
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
