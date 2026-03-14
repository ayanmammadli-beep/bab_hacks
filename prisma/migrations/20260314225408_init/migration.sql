-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('VOTING', 'APPROVED', 'REJECTED', 'EXECUTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PredictionProposalStatus" AS ENUM ('VOTING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PredictionMarketStatus" AS ENUM ('ACTIVE', 'RESOLUTION_OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "groupChatId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "usdcBalance" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" TEXT NOT NULL,
    "groupChatId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "side" TEXT,
    "outcomeTokenId" TEXT,
    "outcomeLabel" TEXT,
    "amount" DECIMAL(36,18) NOT NULL,
    "proposer" TEXT NOT NULL,
    "approvalWeight" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "rejectWeight" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "status" "ProposalStatus" NOT NULL DEFAULT 'VOTING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "votes" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vote" TEXT NOT NULL,
    "weight" DECIMAL(10,4) NOT NULL,

    CONSTRAINT "votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" TEXT NOT NULL,
    "groupChatId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "side" TEXT,
    "outcomeTokenId" TEXT,
    "outcomeLabel" TEXT,
    "shares" DECIMAL(36,18) NOT NULL,
    "avgPrice" DECIMAL(36,18) NOT NULL,
    "currentPrice" DECIMAL(36,18) NOT NULL,
    "status" "PositionStatus" NOT NULL DEFAULT 'OPEN',
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "txHash" TEXT,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prediction_market_proposals" (
    "id" TEXT NOT NULL,
    "groupChatId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "eventDeadline" TIMESTAMP(3) NOT NULL,
    "initialLiquidityAmount" DECIMAL(36,18) NOT NULL,
    "proposer" TEXT NOT NULL,
    "approvalWeight" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "rejectWeight" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "status" "PredictionProposalStatus" NOT NULL DEFAULT 'VOTING',
    "deadline" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prediction_market_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prediction_market_proposal_votes" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vote" TEXT NOT NULL,
    "weight" DECIMAL(10,4) NOT NULL,

    CONSTRAINT "prediction_market_proposal_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prediction_markets" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT,
    "groupChatId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "eventDeadline" TIMESTAMP(3) NOT NULL,
    "initialLiquidityAmount" DECIMAL(36,18) NOT NULL,
    "status" "PredictionMarketStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolutionOpenedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "winningSide" TEXT,

    CONSTRAINT "prediction_markets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prediction_bets" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "side" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prediction_bets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prediction_resolution_votes" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prediction_resolution_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prediction_payouts" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prediction_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_groupChatId_key" ON "wallets"("groupChatId");

-- CreateIndex
CREATE INDEX "proposals_groupChatId_idx" ON "proposals"("groupChatId");

-- CreateIndex
CREATE INDEX "proposals_status_deadline_idx" ON "proposals"("status", "deadline");

-- CreateIndex
CREATE INDEX "votes_proposalId_idx" ON "votes"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "votes_proposalId_userId_key" ON "votes"("proposalId", "userId");

-- CreateIndex
CREATE INDEX "positions_groupChatId_idx" ON "positions"("groupChatId");

-- CreateIndex
CREATE INDEX "positions_marketId_groupChatId_status_idx" ON "positions"("marketId", "groupChatId", "status");

-- CreateIndex
CREATE INDEX "prediction_market_proposals_groupChatId_idx" ON "prediction_market_proposals"("groupChatId");

-- CreateIndex
CREATE INDEX "prediction_market_proposals_status_deadline_idx" ON "prediction_market_proposals"("status", "deadline");

-- CreateIndex
CREATE INDEX "prediction_market_proposal_votes_proposalId_idx" ON "prediction_market_proposal_votes"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "prediction_market_proposal_votes_proposalId_userId_key" ON "prediction_market_proposal_votes"("proposalId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "prediction_markets_proposalId_key" ON "prediction_markets"("proposalId");

-- CreateIndex
CREATE INDEX "prediction_markets_groupChatId_idx" ON "prediction_markets"("groupChatId");

-- CreateIndex
CREATE INDEX "prediction_markets_status_idx" ON "prediction_markets"("status");

-- CreateIndex
CREATE INDEX "prediction_markets_eventDeadline_idx" ON "prediction_markets"("eventDeadline");

-- CreateIndex
CREATE INDEX "prediction_bets_marketId_idx" ON "prediction_bets"("marketId");

-- CreateIndex
CREATE INDEX "prediction_bets_marketId_userId_idx" ON "prediction_bets"("marketId", "userId");

-- CreateIndex
CREATE INDEX "prediction_resolution_votes_marketId_idx" ON "prediction_resolution_votes"("marketId");

-- CreateIndex
CREATE UNIQUE INDEX "prediction_resolution_votes_marketId_userId_key" ON "prediction_resolution_votes"("marketId", "userId");

-- CreateIndex
CREATE INDEX "prediction_payouts_marketId_idx" ON "prediction_payouts"("marketId");

-- CreateIndex
CREATE INDEX "prediction_payouts_marketId_userId_idx" ON "prediction_payouts"("marketId", "userId");

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_market_proposal_votes" ADD CONSTRAINT "prediction_market_proposal_votes_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "prediction_market_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_bets" ADD CONSTRAINT "prediction_bets_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "prediction_markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_resolution_votes" ADD CONSTRAINT "prediction_resolution_votes_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "prediction_markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_payouts" ADD CONSTRAINT "prediction_payouts_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "prediction_markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
