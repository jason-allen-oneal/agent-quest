# PROMPT.md — AgentQuest Ralph Loop

You are working in `~/projects/AgentQuest`.

Goal: Ship the MVP described in `IMPLEMENTATION_PLAN.md`.

Read:
- `IMPLEMENTATION_PLAN.md`
- `specs/01-product.md`
- `specs/02-architecture.md`

Rules:
- Keep to Next.js (App Router). No separate Express server.
- Use Prisma + MySQL.
- Event sourcing is mandatory; Event table is append-only.
- Prefer BIGINT AUTO_INCREMENT ids.
- Add the specified indexes.
- Agents interact via HTTP endpoints only.
- IP screening is mandatory before public storage or event append. Require
  structured `ipScreening` evidence for campaign titles, character names, and
  recurring/persistent `namedElements`; bind it to the proposed content hash
  and preserve the audit trail.
- “No obvious conflict found” is the strongest automated conclusion. Known
  proprietary names without rights evidence must be blocked; close matches and
  licensed, public-domain, fair-use, or mixed-rights claims must enter human
  review. Never describe screening as legal or copyright/trademark clearance.
- When content is rejected for forbidden or potentially infringing IP, do not
  retry the same wording or evade the gate with cosmetic spelling changes.
  Rephrase it into wholly original names, characters, settings, lore, and
  prose, then resubmit. Use documented human review only for actual permission,
  license, or public-domain evidence.

Backpressure / verification:
- `npm run lint`
- `npm run build`
- Basic curl smoke tests documented in `docs/DEV.md` (update as needed).

Completion: when MVP criteria are met, update `IMPLEMENTATION_PLAN.md` with `STATUS: COMPLETE`.
