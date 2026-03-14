# Polymarket Group Bot API

Backend for a **group chat bot** that trades on **Polymarket** (Polygon). Each group gets its own Polygon wallet; the group votes on trade proposals, and approved trades are executed automatically.

---

## What you can do

- **Browse markets** – List and search Polymarket markets, get details and outcome tokens.
- **Propose trades** – Create a proposal to buy a specific outcome (e.g. “Trump wins” or YES/NO) for a given dollar amount.
- **Vote** – Members vote approve/reject with optional weights; proposals need enough approval (default 60%) to execute.
- **Execute** – Once the vote passes and before the market closes, anyone can trigger execution; the group wallet places the order on Polymarket.
- **Track positions** – See open and closed positions for the group and close (sell) a position when you want to exit.

---

## Setup

```bash
cd polymarket-group-bot
npm install
npm run setup-env    # creates .env with a random encryption key and default DB URL
```

Edit `.env` and set `DATABASE_URL` if needed (e.g. for your PostgreSQL instance). Then:

```bash
npx prisma generate
npx prisma db push
npm run dev
```

API runs at **http://localhost:3000** (or `PORT` in `.env`).

---

## API reference

Base URL: **`http://localhost:3000`** (or your deployed URL).  
All request/response bodies are **JSON**.

---

### Health

| Method | Path       | Description        |
|--------|------------|--------------------|
| `GET`  | `/health`  | Liveness check     |

**Response**  
`200` – `{ "status": "ok" }`

---

### Markets

Data comes from Polymarket’s public APIs. No auth required.

| Method | Path              | Description                    |
|--------|-------------------|--------------------------------|
| `GET`  | `/markets`        | List active markets            |
| `GET`  | `/markets?search=<query>` | Search markets by keyword |
| `GET`  | `/markets/:marketId`     | Get one market by ID/slug/condition_id |

**Examples**

```bash
# List markets
curl http://localhost:3000/markets

# Search
curl "http://localhost:3000/markets?search=election"

# One market (use condition_id or slug from list)
curl http://localhost:3000/markets/0x...
```

**Market response** (relevant fields): `condition_id`, `question`, `tokens` (array of `{ token_id, outcome, price }`), `end_date_iso`, `active`, `closed`. Use `tokens[].token_id` and `tokens[].outcome` when creating proposals.

---

### Proposals

Proposals are per **group chat** (`groupChatId`). Creating a proposal ensures a wallet exists for that group. You can specify either:

- **Multi-outcome**: `outcomeTokenId` (and optional `outcomeLabel`) – use for markets with many outcomes.
- **Binary**: `side: "YES"` or `"NO"` – for simple yes/no markets.

| Method | Path                      | Description              |
|--------|---------------------------|--------------------------|
| `POST` | `/proposals`              | Create a trade proposal  |
| `GET`  | `/proposals?groupChatId=<id>` | List proposals for a group |
| `POST` | `/proposals/:id/vote`     | Vote on a proposal       |
| `POST` | `/proposals/:id/execute` | Execute if approved      |

**Create proposal**

```bash
# Multi-outcome (use token_id from GET /markets/:marketId → tokens)
curl -X POST http://localhost:3000/proposals \
  -H "Content-Type: application/json" \
  -d '{
    "groupChatId": "chat_123",
    "marketId": "0x...",
    "outcomeTokenId": "12345...",
    "outcomeLabel": "Trump wins",
    "amount": 200,
    "proposer": "alex"
  }'

# Binary YES/NO
curl -X POST http://localhost:3000/proposals \
  -H "Content-Type: application/json" \
  -d '{
    "groupChatId": "chat_123",
    "marketId": "0x...",
    "side": "YES",
    "amount": 100,
    "proposer": "alex"
  }'
```

**Response**  
`201` – `{ "id": "...", "status": "VOTING", "deadline": "..." }`

**List proposals**

```bash
curl "http://localhost:3000/proposals?groupChatId=chat_123"
```

**Response**  
`200` – Array of proposals with `id`, `marketId`, `side`, `outcomeTokenId`, `outcomeLabel`, `amount`, `proposer`, `approvalWeight`, `rejectWeight`, `status`, `deadline`, `createdAt`.

**Vote**

```bash
curl -X POST http://localhost:3000/proposals/PROPOSAL_ID/vote \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "sam",
    "vote": "approve",
    "weight": 0.35
  }'
```

`vote`: `"approve"` or `"reject"`. `weight` is optional (default 1).

**Response**  
`200` – `{ "approvalWeight": 0.5, "rejectWeight": 0.35 }`

**Execute**

```bash
curl -X POST http://localhost:3000/proposals/PROPOSAL_ID/execute
```

**Response**  
- `200` – `{ "status": "executed", "txHash": "...", "positionId": "..." }`  
- `400` – `{ "status": "insufficient_approval" }` or `"expired"` / `"rejected"`

---

### Positions

Positions are trades that have been executed for the group wallet.

| Method | Path                               | Description           |
|--------|------------------------------------|-----------------------|
| `GET`  | `/positions?groupChatId=<id>`      | List positions        |
| `POST` | `/positions/:id/exit`              | Close (sell) a position |

**List positions**

```bash
curl "http://localhost:3000/positions?groupChatId=chat_123"
```

**Response**  
`200` – Array of positions with `id`, `marketId`, `side`, `outcomeTokenId`, `outcomeLabel`, `shares`, `avgPrice`, `currentPrice`, `status` (open/closed), `executedAt`, `closedAt`, `txHash`.

**Close position**

```bash
curl -X POST http://localhost:3000/positions/POSITION_ID/exit \
  -H "Content-Type: application/json" \
  -d '{ "userId": "alex" }'
```

**Response**  
`200` – `{ "status": "closed", "positionId": "...", "marketId": "...", "txHash": "...", "closedAt": "..." }`

---

## Typical flow

1. **GET /markets** or **GET /markets?search=...** – Pick a market and note `condition_id` and one of `tokens[].token_id` (or use `side` for binary).
2. **POST /proposals** – Create a proposal for that market/outcome and amount.
3. **GET /proposals?groupChatId=...** – Share the proposal in the chat; members **POST /proposals/:id/vote**.
4. When approval weight ≥ threshold (default 0.6), **POST /proposals/:id/execute** – the group wallet places the order on Polymarket.
5. **GET /positions?groupChatId=...** – See open positions; **POST /positions/:id/exit** when the group wants to sell.

---

## Configuration

In `.env`:

| Variable                 | Description                          |
|--------------------------|--------------------------------------|
| `PORT`                   | Server port (default 3000)            |
| `DATABASE_URL`           | PostgreSQL connection string         |
| `WALLET_ENCRYPTION_KEY`  | 32-byte hex (64 chars) for encrypting wallet keys |
| `DEFAULT_APPROVAL_WEIGHT`| Approval threshold (default 0.6)      |
| `POLYMARKET_CLOB_HOST`   | CLOB API (default https://clob.polymarket.com) |
| `POLYMARKET_GAMMA_HOST`  | Gamma API (default https://gamma-api.polymarket.com) |
| `POLYGON_CHAIN_ID`       | 137 for Polygon mainnet              |

---

## Scripts

| Command           | Description                    |
|-------------------|--------------------------------|
| `npm run dev`     | Start server with hot reload   |
| `npm run build`   | Compile TypeScript             |
| `npm start`       | Run compiled `dist/index.js`   |
| `npm run test:api`| Smoke test (server must be running) |
| `npm run setup-env` | Create `.env` from template   |
| `npx prisma db push` | Apply schema to DB          |
| `npx prisma studio`  | Open Prisma Studio          |
# bab_hacks

Liquid (tryliquid.xyz) API integration for the Group-Chat Hedge Fund platform.

## Liquid API keys — if "failed to create API key"

Liquid only lets you create API keys after your account is fully set up. Do these **in order**:

1. **Fund your account** — Deposit USDC (top-right **Deposit** in the app). Key creation may require a non-zero balance.
2. **Enable trading** — Go to the **Trade** screen and click **Enable Trading** in the order panel. This turns on your on-chain trading vault; key creation often depends on this.
3. **Then** create a key at [app.tryliquid.xyz/account/api-keys](https://app.tryliquid.xyz/account/api-keys).

Referral/hackathon credits (e.g. BABHACK) usually don’t change these steps; they might add bonus balance or fee discounts but key creation still needs 1 and 2 done. If it still fails after both are done, try a hard refresh, another browser, or contact support (e.g. via [sdk.tryliquid.xyz](https://sdk.tryliquid.xyz/) or the app).
