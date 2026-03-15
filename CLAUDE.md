# bab_hacks — Group Chat Hedge Fund

## What this project is
A **Group Chat Hedge Fund** platform. Friend groups manage a shared crypto investment fund entirely through iMessage. They deposit money, propose trades, vote on them, and the system executes on Polymarket (prediction markets) or Liquid (crypto derivatives).

## Repo layout

| Path | Language | Port | Role |
|------|----------|------|------|
| `/imessage` | Node.js | 3000 | iMessage bot — LINQ webhook listener, NLP, command routing |
| `/XRPL-API` | TypeScript | 3001 | Reserve vault — XRPL deposits, voting weights, escrow, Liquid trades |
| `/src` | TypeScript | 3002 | Trading vault — Polygon/USDC wallet, Polymarket CLOB execution |
| `/liquid` | TypeScript | — | Liquid SDK (used internally by XRPL-API, not called directly by iMessage) |

## Architecture — Dual Vault System

```
iMessage (LINQ bot, port 3000)
        │
        ▼
   backend.js  ← single wiring layer in /imessage/src/backend.js
        │
   ┌────┴─────────────────────────┐
   │                              │
XRPL-API (port 3001)        /src Polymarket backend (port 3002)
RESERVE VAULT               TRADING VAULT
- XRP deposits              - USDC on Polygon
- voting weights            - Polymarket CLOB execution
- XRPL escrow               - Polygon EVM wallets
- Liquid orders (auto)
```

**Reserve Vault** — users deposit XRP. Deposit share = voting weight. Vote passes → XRPL escrow created. Liquid trades placed automatically.

**Trading Vault** — USDC on Polygon. Used exclusively for Polymarket execution. The iMessage bot triggers this after a vote passes.

## Key iMessage source files

- `imessage/src/backend.js` — all outbound calls to XRPL-API and Polymarket go through here
- `imessage/src/store.js` — persists `chatId → xrplGroupId`, `senderHandle → xrplMemberId`, active proposals (in `data/store.json`)
- `imessage/src/wallets.js` — per-user XRPL wallets (`data/wallets.json`)
- `imessage/src/nlp.js` — Claude-powered intent extraction from plain English
- `imessage/src/router.js` — dispatches to handlers, passes `context.data` (structured NLP output)
- `imessage/src/handlers/proposeTrade.js` — consumes structured `context.data`
- `imessage/src/handlers/deposit.js` — routes deposits to voting vs trading vault
- `imessage/src/handlers/portfolio.js` — shows both vault balances

## Supported commands (slash or plain English via NLP)
- `/createfund [name]`
- `/deposit <amount> voting|trading`
- `/propose_trade` (NLP extracts: type, market, side, amount)
- `/vote yes|no` (or emoji reaction)
- `/portfolio`
- `/my_wallet`

## Trade flow summary

**Polymarket bet:**
1. NLP extracts `{ type: 'polymarket', market, side, amount }`
2. `backend.proposeTrade` → search `/markets` → get `condition_id`
3. Create proposal in XRPL-API → group votes (weighted)
4. Vote passes → XRPL escrow created
5. `backend._executePolymarketTrade` → POST to Polymarket backend → execute on CLOB

**Liquid derivatives:**
1. NLP extracts `{ type: 'liquid', market: 'BTC-PERP', side, amount }`
2. Create proposal → vote passes → XRPL-API creates escrow AND places Liquid order automatically

## Running the services

```bash
# iMessage bot
cd imessage && npm start   # port 3000

# Reserve vault
cd XRPL-API && npm start   # port 3001 (set PORT=3001 in env)

# Trading vault
# (root /src) port 3002 (set PORT=3002 in env)
```

## Environment variables

### `/imessage/.env`
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

### `/XRPL-API`
```
PORT=3001
XRPL_NETWORK=testnet
LIQUID_API_KEY=
LIQUID_API_SECRET=
```

### `/src` (Polymarket backend)
```
PORT=3002
DATABASE_URL=postgresql://...
WALLET_ENCRYPTION_KEY=<32-byte hex>
POLYMARKET_CLOB_HOST=https://clob.polymarket.com
POLYMARKET_GAMMA_HOST=https://gamma-api.polymarket.com
POLYGON_CHAIN_ID=137
```

## Known issues / TODO
- XRPL-API and Polymarket backend both default to port 3000 — must set `PORT` env var
- Reaction votes arrive with `voter: "unknown"` — LINQ webhook may not include sender handle in reaction events
- Settlement flow (`/settle`) not yet wired from iMessage
- End-to-end testing not yet done with live backends
