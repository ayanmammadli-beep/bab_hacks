# Prediction market test

Runs a full smoke test of the off-chain prediction market API with simulated data (no wallets).

## Prerequisites

- `.env` with `DATABASE_URL` and `WALLET_ENCRYPTION_KEY` (same as main API)
- Database schema applied: `npx prisma db push`
- Server running: `npm run dev` (in another terminal)

## Run

```bash
npm run test:prediction
```

Optional: override API base URL:

```bash
BASE_URL=http://localhost:3000 npm run test:prediction
```

## What it does

1. Creates a prediction market **proposal** (description, event deadline 2 min in the past, initial liquidity 100).
2. Lists proposals and votes approve as 3 simulated users (alice, bob, carol) so approval passes the 60% threshold.
3. **Executes** the proposal to create the market.
4. Places **bets**: alice YES 20, bob NO 30, carol YES 10.
5. **Gets the market** (which opens the resolution window because event deadline has passed).
6. Submits **resolution votes**: alice YES, bob NO, carol YES (majority YES).
7. **Gets payouts** and prints winning side and winner amounts.

All data uses a unique `groupChatId` and fake user ids; nothing touches Polymarket or real wallets.
