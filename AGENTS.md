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
