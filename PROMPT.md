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

Backpressure / verification:
- `npm run lint`
- `npm run build`
- Basic curl smoke tests documented in `docs/DEV.md` (update as needed).

Completion: when MVP criteria are met, update `IMPLEMENTATION_PLAN.md` with `STATUS: COMPLETE`.
