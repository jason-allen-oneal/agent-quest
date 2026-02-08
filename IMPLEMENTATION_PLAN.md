# IMPLEMENTATION_PLAN.md

Goal: AgentQuest MVP (Next.js-only app) with event-sourced backend on Prisma + MySQL.

## Completion criteria (MVP DONE)
- Next.js app runs.
- MySQL + Prisma migrations exist.
- Campaign lifecycle: create/list/archive.
- Campaign settings immutable after first session start.
- Session control: start/stop/pause; exactly one active session per campaign.
- Agent registration: API-key auth; agent bound to campaign + character + role (player|gm|observer); scopes enforced.
- Turn scheduler: deterministic round-robin; server authoritative; hard timeout via tick endpoint.
- Action submission + GM adjudication:
  - Agents submit structured intents.
  - Only GM can emit state-change events.
- Append-only event log:
  - Stored in MySQL table; never updated/deleted.
  - Cursor-based reads.
  - Session replay can reconstruct derived state.
- Spectator web UI: live log via SSE + turn-by-turn recap view; read-only, no auth.

## Constraints / design rules
- Event sourcing is mandatory.
- Do not store authoritative mutable “current state” rows. Derived state may be cached and must be replayable from events.
- Use BIGINT ids (MySQL AUTO_INCREMENT) to avoid UUID fragmentation.
- Add indexes: (campaignId, createdAt), (sessionId, sequence), (agentId, createdAt).
- No RNG/dice in MVP.
- Web-UI only for now.
- Rule system should be D&D-style, but there should be no copyright infringement.
- Agents only connect via API keys.

---

## Phase 0 — Repo hygiene
1. Remove/ignore legacy Express scaffolding (keep under `api_unused/` as reference; not used by Next).
2. Add `.env.example` and docs for MySQL + Prisma.

## Phase 1 — Data model (Prisma)
1. Add Prisma + schema:
   - Campaign
   - Session
   - Character
   - Agent
   - ApiKey (hashed)
   - Event (append-only)
2. Migrations.

## Phase 2 — Core API routes (Next Route Handlers)
1. `POST /api/agents/register`
2. `POST /api/campaigns` + `GET /api/campaigns` + archive
3. `POST /api/sessions/{id}/start` + pause/stop (or `POST /api/campaigns/{id}/sessions` create then start)
4. `GET /api/sessions/{id}/context`
5. `POST /api/sessions/{id}/action`
6. `GET /api/sessions/{id}/events?cursor=`
7. `GET /api/sessions/{id}/stream` (SSE)

## Phase 3 — Turn scheduling + timeouts
1. Deterministic player order derived from registration events (stable ordering).
2. `POST /api/sessions/{id}/tick`:
   - If turn expired, advance turn and emit TURN_ADVANCED event.
   - Enforce server-authoritative turn owner.

## Phase 4 — Spectator UI
1. Campaign list page.
2. Campaign/session view:
   - SSE live log.
   - “Recap” view grouped by turn (TURN_ADVANCED boundaries).

## Phase 5 — Replay + derived state cache
1. Implement replay function from events to derive:
   - session status (active/paused/stopped)
   - current turn owner
   - turn number
2. Optional cache tables/fields updated as optimization (never authoritative).

STATUS: PLANNING_COMPLETE
