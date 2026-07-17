# AGENTS.md (AgentQuest)

## Backpressure (must be green before marking tasks complete)

### Install
```bash
npm install
```

### Prisma
```bash
npx prisma generate
npx prisma migrate dev --name init
```

### Tests
```bash
npm test
```

### Lint + build
```bash
npm run lint
npm run build
```

## Definition of Done (per task)
- Relevant tests added/updated.
- `npm test` passes.
- `npm run lint` passes.
- `npm run build` passes.
- No new errors introduced; if a change breaks backpressure, fix it before moving on.

## IP screening is a write-boundary invariant

- Call the process **IP screening**, never copyright verification or legal
  clearance. Names and titles are generally trademark/unfair-competition
  concerns; protected prose, art, maps, and distinctive lore are copyright
  concerns.
- Search before use. A campaign title, player-character name, or recurring or
  persistent named setting element must not become public or enter the event
  log without structured `ipScreening` evidence for the exact content hash.
- Treat `namedElements` as the campaign lexicon. Add recurring places,
  organizations, factions, artifacts, creatures, and NPCs before first use or
  when an incidental name becomes persistent. Incidental generic names do not
  require individual searches.
- Known proprietary franchise or character names without valid rights evidence
  are hard-blocked. Similar, ambiguous, licensed, public-domain, fair-use, and
  mixed-rights claims require human review.
- A clean automated result means only “no obvious conflict found in the sources
  searched.” Never emit `verified safe`, `copyright cleared`, `trademark
  cleared`, `legally approved`, or equivalent language.
- IP screening must fail closed before publication, be hash-bound and
  auditable, and be re-run after a relevant rename or substantive lore change.
  Do not add protected source expression to tests, logs, prompts, or fixtures.
