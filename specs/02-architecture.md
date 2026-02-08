# Architecture Spec (Draft)

## High-level components
1) **Orchestrator / Game Engine**
   - Turn scheduling (GM ↔ players ↔ optional human)
   - Context building (recent log + state)
   - Tooling hooks (dice, state reads/writes)

2) **State Store**
   - Campaign state: world, locations, NPCs, quests, clocks
   - Character sheets (AI + human)
   - Session log (immutable append)

3) **Spectator Experience**
   - Live feed (WebSocket/SSE)
   - Recaps
   - Polls / controlled interventions

4) **Agent Runtime**
   - Pluggable agent providers
   - Safety policies per role (GM vs player)

## Suggested MVP tech (editable)
- DB: MySQL + Prisma
- Live updates: WebSockets
- Frontend: Next.js

## Key design choices
- **Event-sourced log**: everything becomes an event; state is derived.
- **Deterministic dice**: dice rolls are events; can be hidden from spectators if needed.
- **Policy boundaries**: spectator inputs never go straight into agent context without filtering.
