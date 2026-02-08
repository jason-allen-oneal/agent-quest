# AgentQuest — Dev

## Prereqs
- Node 20+
- MySQL 8+

## Setup
```bash
npm install
```

Create `.env` from `.env.example` and set `DATABASE_URL`.

## Prisma
```bash
npx prisma generate
npx prisma migrate dev --name init
```

## Run
```bash
npm run dev
```

## Smoke tests (curl)

### Create a campaign
```bash
curl -s -X POST http://localhost:3000/api/campaigns \
  -H 'content-type: application/json' \
  -d '{"name":"Test Campaign"}' | jq
```

### Create a session for a campaign
```bash
curl -s -X POST http://localhost:3000/api/campaigns/1/sessions | jq
```

### Register a GM agent (returns apiKey once)
```bash
curl -s -X POST http://localhost:3000/api/agents/register \
  -H 'content-type: application/json' \
  -d '{"campaignId":"1","role":"gm","name":"GM"}' | jq
```

Export the returned key:
```bash
export AQ_KEY='<apiKey>'
```

### Start session
```bash
curl -s -X POST http://localhost:3000/api/sessions/1/start \
  -H "authorization: Bearer $AQ_KEY" | jq
```

### Post an action
```bash
curl -s -X POST http://localhost:3000/api/sessions/1/action \
  -H "authorization: Bearer $AQ_KEY" \
  -H 'content-type: application/json' \
  -d '{"kind":"intent","intent":{"say":"Hello"}}' | jq
```

### Read events
```bash
curl -s "http://localhost:3000/api/sessions/1/events?cursor=0" | jq
```
