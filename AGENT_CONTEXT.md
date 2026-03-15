# Agent Context — bab_hacks

## What this project is
A **Group Chat Hedge Fund** platform. Friend groups manage a shared crypto investment fund entirely through iMessage. They deposit money, propose trades, vote on them, and the system executes on Polymarket (prediction markets) or Liquid (crypto derivatives).

---

## Architecture — Dual Vault System

```
iMessage (LINQ bot)
        │
        ▼
   backend.js  ← single integration point in /imessage/src/backend.js
        │
   ┌────┴────────────────────┐
   │                         │
XRPL-API (port 3001)    Polymarket backend (port 3002)
RESERVE VAULT           TRADING VAULT
- tracks deposits       - executes Polymarket trades
- drives voting weight  - holds Polygon/USDC wallet
- escrow on XRPL        - calls Polymarket CLOB
- Liquid integration
```

### Two vaults, two purposes
- **Reserve Vault (XRPL-API)** — users deposit XRP here. Their deposit share = their voting weight. When a vote passes, XRPL creates an escrow and (for Liquid trades) places the order automatically.
- **Trading Vault (Polymarket backend `/src`)** — holds USDC on Polygon. Used to actually execute Polymarket trades. Liquid trades go through XRPL-API directly.

---

## Services

### 1. `/imessage` — iMessage bot (Node.js, port 3000)
The messaging layer. Parses commands, runs NLP via Claude API, routes to handlers, calls backend services.

**Key files:**
- `src/backend.js` — **the wiring layer**. All calls to XRPL-API and Polymarket go through here. Recently fully implemented (was previously a mock stub).
- `src/store.js` — persists ID mappings: `chatId → xrplGroupId`, `senderHandle → xrplMemberId`, active proposal per chat (in `data/store.json`)
- `src/wallets.js` — manages per-user XRPL wallets (in `data/wallets.json`)
- `src/coinbaseOnramp.js` — generates Coinbase Onramp URLs for XRP deposits
- `src/nlp.js` — Claude-powered NLP. Extracts structured intent from plain English messages
- `src/router.js` — dispatches to handlers, passes `context.data` (structured NLP output)
- `src/handlers/deposit.js` — handles `/deposit`, asks user which vault (voting or trading)
- `src/handlers/proposeTrade.js` — uses structured `context.data` from NLP
- `src/handlers/portfolio.js` — shows both reserve + trading vault

**Supported commands (slash or plain English):**
- `/createfund [name]`
- `/deposit <amount> voting|trading`
- `/propose_trade` (NLP extracts type/market/side/amount)
- `/vote yes|no`
- `/portfolio`
- `/my_wallet`

**Env vars needed:**
```
LINQ_API_TOKEN=
LINQ_FROM_NUMBER=
LINQ_WEBHOOK_SECRET=
ANTHROPIC_API_KEY=
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=
XRPL_API_URL=http://localhost:3001
POLYMARKET_API_URL=http://localhost:3002
PORT=3000
```

---

### 2. `/XRPL-API` — Reserve vault backend (TypeScript, port 3001)
Manages XRPL group wallets, voting weights, proposals, escrow, and Liquid trading.

**Key endpoints:**
- `POST /groups` — create group fund
- `POST /groups/:id/members` — register a member (handle + xrplAddress)
- `POST /groups/:id/deposit` — record deposit (memberId + amount in XRP)
- `GET /groups/:id/balances` — member shares and voting weights
- `GET /groups/:id/portfolio` — full summary: vault, members, proposals, positions
- `POST /proposals` — create trade proposal `{ groupId, proposerId, type: 'crypto'|'prediction', market, side, amount }`
- `POST /proposals/:id/vote` — `{ memberId, vote: 'yes'|'no' }` — returns `{ status: 'approved_and_executed'|'open'|'rejected', yesWeight, noWeight, escrow, liquidOrder }`
- `POST /settlement/settle` — settle a proposal outcome

When a proposal vote passes:
- Escrow is created on XRPL automatically
- If Liquid is configured: Liquid order is placed automatically
- For Polymarket proposals: escrow is created but Polymarket execution is triggered externally by the iMessage backend

**Env vars needed:**
```
PORT=3001
XRPL_NETWORK=testnet
LIQUID_API_KEY=
LIQUID_API_SECRET=
```

---

### 3. `/src` — Polymarket trading backend (TypeScript, port 3002)
Manages Polygon EVM wallets, searches Polymarket markets, creates/executes proposals on the CLOB.

**Key endpoints:**
- `POST /wallets/:groupChatId` — create Polygon wallet
- `POST /wallets/:groupChatId/fund` — record USDC deposit `{ amount }`
- `GET /wallets/:groupChatId` — get wallet address + USDC balance
- `GET /markets?search=xxx` — search Polymarket markets, returns `[{ condition_id, question, tokens: [{token_id, outcome, price}] }]`
- `POST /proposals` — `{ groupChatId, marketId (condition_id), amount, proposer, side: 'YES'|'NO' }`
- `POST /proposals/:id/vote` — `{ userId, vote: 'approve'|'reject', weight? }`
- `POST /proposals/:id/execute` — executes on Polymarket CLOB, returns `{ status, txHash, positionId }`
- `GET /positions?groupChatId=xxx` — open positions

**Env vars needed:**
```
PORT=3002
DATABASE_URL=postgresql://...
WALLET_ENCRYPTION_KEY=<32-byte hex>
POLYMARKET_CLOB_HOST=https://clob.polymarket.com
POLYMARKET_GAMMA_HOST=https://gamma-api.polymarket.com
POLYGON_CHAIN_ID=137
```

---

### 4. `/liquid` — Liquid API client library (TypeScript)
A reusable SDK for the Liquid derivatives platform. Used directly by XRPL-API internally — the iMessage bot does NOT call this directly.

- HMAC-SHA256 auth
- Auto-retry on 429/502/503/504 (1s, 2s, 4s backoff)
- Key functions: `placeOrder`, `getMarkets`, `getTicker`, `getBalances`, `cancelOrder`

---

## Trade flow end-to-end

### Polymarket prediction bet
1. User: *"tars bet 50 on Trump winning the election"*
2. NLP extracts: `{ type: 'polymarket', market: 'trump wins election', side: 'yes', amount: 50 }`
3. `backend.proposeTrade` → searches Polymarket `/markets?search=trump wins election` → gets `condition_id`
4. Creates proposal in XRPL-API → group votes (weighted by XRP deposits)
5. Vote passes → XRPL-API creates escrow
6. `backend._executePolymarketTrade` → `POST /proposals` + force-approve + `POST /proposals/:id/execute` on Polymarket backend
7. Trade executes on Polymarket CLOB

### Liquid crypto derivatives
1. User: *"tars long 100 on BTC"*
2. NLP extracts: `{ type: 'liquid', market: 'BTC-PERP', side: 'long', amount: 100 }`
3. Creates proposal in XRPL-API → group votes
4. Vote passes → XRPL-API creates escrow AND places Liquid order automatically

### Deposit to voting vault
1. User: *"tars i want more voting power, deposit 500 into the voting pool"*
2. NLP detects `vault: 'voting'`, amount 500
3. Coinbase Onramp link generated for XRP → user's XRPL wallet
4. On-chain XRP detected → `POST /groups/:id/deposit` → voting weight updated

### Deposit to trading vault
1. User: *"tars put 200 in the trading vault"*
2. `POST /wallets/:chatId/fund` on Polymarket backend

---

## State management
The iMessage bot persists mappings in `imessage/data/store.json`:
- `groups`: `{ [chatId]: { xrplGroupId } }`
- `members`: `{ [chatId]: { [senderHandle]: xrplMemberId } }`
- `proposals`: `{ [chatId]: { xrplProposalId, type, polymarketMarketId, side, amount } }`

User XRPL wallets in `imessage/data/wallets.json`:
- `{ [phone]: { address, seed } }`

---

## What's working vs what's TODO

### Working
- iMessage parsing (slash commands + NLP plain English)
- Dual-vault deposit routing (voting vs trading)
- Structured trade proposals (Polymarket vs Liquid, NLP extracts all fields)
- Voting with XRPL reserve vault weights
- Full wiring in `backend.js` to both XRPL-API and Polymarket backend
- Coinbase Onramp for XRP deposits

### Still needs work / not yet tested end-to-end
- XRPL-API and Polymarket backend need to run on ports 3001 and 3002 respectively (both default to 3000 — change their PORT env var)
- Reaction votes carry `voter: "unknown"` from LINQ webhook — the LINQ reaction event payload may not include sender handle, worth investigating
- Portfolio handler shows live data once backends are running
- Settlement flow (win/loss payout) not yet triggered from iMessage — would need a `/settle` command or admin webhook
