import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { config } from "../config.js";
import {
  PredictionMarketStatus,
  PredictionProposalStatus,
} from "@prisma/client";

const prisma = new PrismaClient();

const APPROVAL_THRESHOLD = config.predictionMarket.approvalThreshold;
const RESOLUTION_THRESHOLD = config.predictionMarket.resolutionThreshold;
const RESOLUTION_WINDOW_MS = config.predictionMarket.resolutionWindowHours * 60 * 60 * 1000;

function toNum(d: Decimal | number): number {
  if (typeof d === "number") return d;
  return Number(d);
}

// --- Proposals ---

export async function createPredictionProposal(params: {
  groupChatId: string;
  description: string;
  eventDeadline: Date;
  initialLiquidityAmount: number;
  proposer: string;
}): Promise<{ id: string; status: string; deadline: Date }> {
  const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days to vote
  const proposal = await prisma.predictionMarketProposal.create({
    data: {
      groupChatId: params.groupChatId,
      description: params.description,
      eventDeadline: params.eventDeadline,
      initialLiquidityAmount: new Decimal(params.initialLiquidityAmount),
      proposer: params.proposer,
      status: PredictionProposalStatus.VOTING,
      deadline,
    },
  });
  return {
    id: proposal.id,
    status: proposal.status,
    deadline: proposal.deadline,
  };
}

export async function listPredictionProposals(groupChatId: string): Promise<
  Array<{
    id: string;
    description: string;
    eventDeadline: Date;
    initialLiquidityAmount: string;
    proposer: string;
    approvalWeight: string;
    rejectWeight: string;
    status: string;
    deadline: Date;
    createdAt: Date;
  }>
> {
  await expirePredictionProposals(groupChatId);
  const list = await prisma.predictionMarketProposal.findMany({
    where: { groupChatId },
    orderBy: { createdAt: "desc" },
  });
  return list.map((p) => ({
    id: p.id,
    description: p.description,
    eventDeadline: p.eventDeadline,
    initialLiquidityAmount: p.initialLiquidityAmount.toString(),
    proposer: p.proposer,
    approvalWeight: p.approvalWeight.toString(),
    rejectWeight: p.rejectWeight.toString(),
    status: p.status,
    deadline: p.deadline,
    createdAt: p.createdAt,
  }));
}

async function expirePredictionProposals(groupChatId: string): Promise<void> {
  const now = new Date();
  await prisma.predictionMarketProposal.updateMany({
    where: {
      groupChatId,
      status: PredictionProposalStatus.VOTING,
      deadline: { lt: now },
    },
    data: { status: PredictionProposalStatus.EXPIRED },
  });
}

export async function voteOnPredictionProposal(
  proposalId: string,
  params: { userId: string; vote: "approve" | "reject"; weight?: number }
): Promise<{ approvalWeight: number; rejectWeight: number }> {
  const weight = params.weight ?? 1;
  const proposal = await prisma.predictionMarketProposal.findUnique({
    where: { id: proposalId },
  });
  if (!proposal) throw new Error("Proposal not found");
  if (proposal.status !== PredictionProposalStatus.VOTING) {
    throw new Error("Proposal is not in voting");
  }

  await prisma.predictionMarketProposalVote.upsert({
    where: {
      proposalId_userId: { proposalId, userId: params.userId },
    },
    create: {
      proposalId,
      userId: params.userId,
      vote: params.vote,
      weight: new Decimal(weight),
    },
    update: {
      vote: params.vote,
      weight: new Decimal(weight),
    },
  });

  const votes = await prisma.predictionMarketProposalVote.findMany({
    where: { proposalId },
  });
  let approvalWeight = 0;
  let rejectWeight = 0;
  for (const v of votes) {
    const w = toNum(v.weight);
    if (v.vote === "approve") approvalWeight += w;
    else rejectWeight += w;
  }

  await prisma.predictionMarketProposal.update({
    where: { id: proposalId },
    data: {
      approvalWeight: new Decimal(approvalWeight),
      rejectWeight: new Decimal(rejectWeight),
    },
  });

  return { approvalWeight, rejectWeight };
}

export async function executePredictionProposal(proposalId: string): Promise<{
  status: "created" | "insufficient_approval" | "expired" | "rejected" | "already_created";
  marketId?: string;
}> {
  const proposal = await prisma.predictionMarketProposal.findUnique({
    where: { id: proposalId },
  });
  if (!proposal) throw new Error("Proposal not found");

  if (proposal.status === PredictionProposalStatus.APPROVED) {
    const existing = await prisma.predictionMarket.findUnique({
      where: { proposalId },
    });
    if (existing) {
      return { status: "already_created", marketId: existing.id };
    }
  }

  if (proposal.status !== PredictionProposalStatus.VOTING) {
    if (proposal.status === PredictionProposalStatus.APPROVED) {
      const market = await prisma.predictionMarket.findUnique({
        where: { proposalId },
      });
      return { status: "already_created", marketId: market?.id };
    }
    return {
      status: proposal.status.toLowerCase() as "expired" | "rejected",
    };
  }

  const now = new Date();
  if (proposal.deadline < now) {
    await prisma.predictionMarketProposal.update({
      where: { id: proposalId },
      data: { status: PredictionProposalStatus.EXPIRED },
    });
    return { status: "expired" };
  }

  const approval = toNum(proposal.approvalWeight);
  const total = approval + toNum(proposal.rejectWeight);
  const ratio = total > 0 ? approval / total : 0;
  if (ratio < APPROVAL_THRESHOLD) {
    return { status: "insufficient_approval" };
  }

  try {
    const market = await prisma.$transaction(async (tx) => {
      const updated = await tx.predictionMarketProposal.updateMany({
        where: { id: proposalId, status: PredictionProposalStatus.VOTING },
        data: { status: PredictionProposalStatus.APPROVED },
      });
      if (updated.count === 0) {
        const existing = await tx.predictionMarket.findUnique({
          where: { proposalId },
        });
        if (existing) return existing;
        return null;
      }
      const existing = await tx.predictionMarket.findUnique({
        where: { proposalId },
      });
      if (existing) return existing;
      return tx.predictionMarket.create({
        data: {
          proposalId,
          groupChatId: proposal.groupChatId,
          description: proposal.description,
          eventDeadline: proposal.eventDeadline,
          initialLiquidityAmount: proposal.initialLiquidityAmount,
          status: PredictionMarketStatus.ACTIVE,
        },
      });
    });
    if (!market) {
      const existing = await prisma.predictionMarket.findUnique({
        where: { proposalId },
      });
      if (existing) return { status: "already_created", marketId: existing.id };
      return { status: "expired" };
    }
    return { status: "created", marketId: market.id };
  } catch {
    const existing = await prisma.predictionMarket.findUnique({
      where: { proposalId },
    });
    if (existing) return { status: "already_created", marketId: existing.id };
    throw new Error("Proposal not found or no longer in voting");
  }
}

// --- Markets ---

export async function listPredictionMarkets(
  groupChatId: string,
  status?: PredictionMarketStatus
): Promise<
  Array<{
    id: string;
    description: string;
    eventDeadline: Date;
    initialLiquidityAmount: string;
    status: string;
    resolutionOpenedAt: Date | null;
    resolvedAt: Date | null;
    winningSide: string | null;
    createdAt: Date;
    totalYes: string;
    totalNo: string;
    betCount: number;
  }>
> {
  const where: { groupChatId: string; status?: PredictionMarketStatus } = {
    groupChatId,
  };
  if (status) where.status = status;

  const markets = await prisma.predictionMarket.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      bets: true,
    },
  });

  const result = [];
  for (const m of markets) {
    let totalYes = 0;
    let totalNo = 0;
    for (const b of m.bets) {
      const amt = toNum(b.amount);
      if (b.side === "YES") totalYes += amt;
      else totalNo += amt;
    }
    result.push({
      id: m.id,
      description: m.description,
      eventDeadline: m.eventDeadline,
      initialLiquidityAmount: m.initialLiquidityAmount.toString(),
      status: m.status,
      resolutionOpenedAt: m.resolutionOpenedAt,
      resolvedAt: m.resolvedAt,
      winningSide: m.winningSide,
      createdAt: m.createdAt,
      totalYes: String(totalYes),
      totalNo: String(totalNo),
      betCount: m.bets.length,
    });
  }
  return result;
}

export async function getPredictionMarket(marketId: string): Promise<{
  id: string;
  groupChatId: string;
  description: string;
  eventDeadline: Date;
  initialLiquidityAmount: string;
  status: string;
  resolutionOpenedAt: Date | null;
  resolvedAt: Date | null;
  winningSide: string | null;
  createdAt: Date;
  totalYes: string;
  totalNo: string;
  bets: Array<{ userId: string; amount: string; side: string; createdAt: Date }>;
  resolutionVotes: Array<{ userId: string; outcome: string }>;
} | null> {
  let market = await prisma.predictionMarket.findUnique({
    where: { id: marketId },
    include: { bets: true, resolutionVotes: true },
  });
  if (!market) return null;

  await ensureResolutionState(marketId);
  await resolveByMajorityIfDue(marketId);

  market = await prisma.predictionMarket.findUnique({
    where: { id: marketId },
    include: { bets: true, resolutionVotes: true },
  });
  if (!market) return null;

  let totalYes = 0;
  let totalNo = 0;
  for (const b of market.bets) {
    const amt = toNum(b.amount);
    if (b.side === "YES") totalYes += amt;
    else totalNo += amt;
  }

  return {
    id: market.id,
    groupChatId: market.groupChatId,
    description: market.description,
    eventDeadline: market.eventDeadline,
    initialLiquidityAmount: market.initialLiquidityAmount.toString(),
    status: market.status,
    resolutionOpenedAt: market.resolutionOpenedAt,
    resolvedAt: market.resolvedAt,
    winningSide: market.winningSide,
    createdAt: market.createdAt,
    totalYes: String(totalYes),
    totalNo: String(totalNo),
    bets: market.bets.map((b) => ({
      userId: b.userId,
      amount: b.amount.toString(),
      side: b.side,
      createdAt: b.createdAt,
    })),
    resolutionVotes: market.resolutionVotes.map((v) => ({
      userId: v.userId,
      outcome: v.outcome,
    })),
  };
}

/** If event deadline passed and market is ACTIVE, transition to RESOLUTION_OPEN. */
async function ensureResolutionState(marketId: string): Promise<void> {
  const market = await prisma.predictionMarket.findUnique({
    where: { id: marketId },
  });
  if (!market) return;
  if (market.status !== PredictionMarketStatus.ACTIVE) return;
  if (market.eventDeadline > new Date()) return;

  await prisma.predictionMarket.update({
    where: { id: marketId },
    data: {
      status: PredictionMarketStatus.RESOLUTION_OPEN,
      resolutionOpenedAt: new Date(),
    },
  });
}

/** Resolve by majority if we're past the 24h window. */
async function resolveByMajorityIfDue(marketId: string): Promise<void> {
  const market = await prisma.predictionMarket.findUnique({
    where: { id: marketId },
    include: { resolutionVotes: true },
  });
  if (!market) return;
  if (market.status !== PredictionMarketStatus.RESOLUTION_OPEN) return;
  const openedAt = market.resolutionOpenedAt ?? market.eventDeadline;
  if (new Date().getTime() < openedAt.getTime() + RESOLUTION_WINDOW_MS) return;

  const votes = market.resolutionVotes;
  let yesVotes = 0;
  let noVotes = 0;
  for (const v of votes) {
    if (v.outcome === "YES") yesVotes += 1;
    else noVotes += 1;
  }
  const total = yesVotes + noVotes;
  const winningSide = total === 0 ? "NO" : yesVotes >= noVotes ? "YES" : "NO";

  await finalizeResolution(marketId, winningSide);
}

function getResolutionRatio(votes: { outcome: string }[]): { yesRatio: number; noRatio: number } {
  let yesVotes = 0;
  let noVotes = 0;
  for (const v of votes) {
    if (v.outcome === "YES") yesVotes += 1;
    else noVotes += 1;
  }
  const total = yesVotes + noVotes;
  if (total === 0) return { yesRatio: 0.5, noRatio: 0.5 };
  return {
    yesRatio: yesVotes / total,
    noRatio: noVotes / total,
  };
}

async function finalizeResolution(marketId: string, winningSide: "YES" | "NO"): Promise<void> {
  const market = await prisma.predictionMarket.findUnique({
    where: { id: marketId },
    include: { bets: true },
  });
  if (!market) return;
  if (market.status === PredictionMarketStatus.RESOLVED) return;

  const now = new Date();
  await prisma.predictionMarket.update({
    where: { id: marketId },
    data: {
      status: PredictionMarketStatus.RESOLVED,
      resolvedAt: now,
      winningSide,
    },
  });

  let totalYes = 0;
  let totalNo = 0;
  for (const b of market.bets) {
    const amt = toNum(b.amount);
    if (b.side === "YES") totalYes += amt;
    else totalNo += amt;
  }
  const totalWinning = winningSide === "YES" ? totalYes : totalNo;
  const totalLosing = winningSide === "YES" ? totalNo : totalYes;

  if (totalWinning > 0 && totalLosing > 0) {
    const payoutData = market.bets
      .filter((b) => b.side === winningSide)
      .map((b) => {
        const amt = toNum(b.amount);
        const share = amt / totalWinning;
        const winnings = share * totalLosing;
        return {
          marketId,
          userId: b.userId,
          amount: new Decimal(winnings),
        };
      });
    if (payoutData.length > 0) {
      await prisma.predictionPayout.createMany({
        data: payoutData,
      });
    }
  }
}

// --- Betting ---

export async function placePredictionBet(params: {
  marketId: string;
  userId: string;
  amount: number;
  side: "YES" | "NO";
}): Promise<{ id: string; marketId: string; userId: string; amount: string; side: string }> {
  const market = await prisma.predictionMarket.findUnique({
    where: { id: params.marketId },
  });
  if (!market) throw new Error("Market not found");
  if (market.status !== PredictionMarketStatus.ACTIVE) {
    throw new Error("Market is not open for betting (status: " + market.status + ")");
  }
  if (params.amount <= 0) throw new Error("Amount must be positive");

  const bet = await prisma.predictionBet.create({
    data: {
      marketId: params.marketId,
      userId: params.userId,
      amount: new Decimal(params.amount),
      side: params.side,
    },
  });
  return {
    id: bet.id,
    marketId: bet.marketId,
    userId: bet.userId,
    amount: bet.amount.toString(),
    side: bet.side,
  };
}

// --- Resolution voting ---

export async function voteOnResolution(
  marketId: string,
  params: { userId: string; outcome: "YES" | "NO" }
): Promise<{
  status: "voted" | "resolved";
  winningSide?: "YES" | "NO";
  resolvedAt?: Date;
}> {
  const market = await prisma.predictionMarket.findUnique({
    where: { id: marketId },
    include: { resolutionVotes: true },
  });
  if (!market) throw new Error("Market not found");
  if (market.status === PredictionMarketStatus.RESOLVED) {
    return {
      status: "resolved",
      winningSide: (market.winningSide as "YES" | "NO") ?? undefined,
      resolvedAt: market.resolvedAt ?? undefined,
    };
  }
  if (market.status !== PredictionMarketStatus.RESOLUTION_OPEN) {
    await ensureResolutionState(marketId);
    const updated = await prisma.predictionMarket.findUnique({
      where: { id: marketId },
    });
    if (updated?.status === PredictionMarketStatus.RESOLVED) {
      return {
        status: "resolved",
        winningSide: (updated.winningSide as "YES" | "NO") ?? undefined,
        resolvedAt: updated.resolvedAt ?? undefined,
      };
    }
    if (updated?.status !== PredictionMarketStatus.RESOLUTION_OPEN) {
      throw new Error("Market is not in resolution window (status: " + (updated?.status ?? market.status) + ")");
    }
  }

  await prisma.predictionResolutionVote.upsert({
    where: {
      marketId_userId: { marketId, userId: params.userId },
    },
    create: {
      marketId,
      userId: params.userId,
      outcome: params.outcome,
    },
    update: { outcome: params.outcome },
  });

  const allVotes = await prisma.predictionResolutionVote.findMany({
    where: { marketId },
  });
  const { yesRatio, noRatio } = getResolutionRatio(allVotes);

  if (yesRatio >= RESOLUTION_THRESHOLD) {
    await finalizeResolution(marketId, "YES");
    const m = await prisma.predictionMarket.findUnique({
      where: { id: marketId },
    });
    return {
      status: "resolved",
      winningSide: "YES",
      resolvedAt: m?.resolvedAt ?? undefined,
    };
  }
  if (noRatio >= RESOLUTION_THRESHOLD) {
    await finalizeResolution(marketId, "NO");
    const m = await prisma.predictionMarket.findUnique({
      where: { id: marketId },
    });
    return {
      status: "resolved",
      winningSide: "NO",
      resolvedAt: m?.resolvedAt ?? undefined,
    };
  }

  await resolveByMajorityIfDue(marketId);
  const after = await prisma.predictionMarket.findUnique({
    where: { id: marketId },
  });
  if (after?.status === PredictionMarketStatus.RESOLVED) {
    return {
      status: "resolved",
      winningSide: (after.winningSide as "YES" | "NO") ?? undefined,
      resolvedAt: after.resolvedAt ?? undefined,
    };
  }

  return { status: "voted" };
}

// --- Payouts ---

export async function getPredictionPayouts(marketId: string): Promise<{
  marketId: string;
  winningSide: string | null;
  liquidityReturned: string;
  payouts: Array<{ userId: string; amount: string; type: "winnings" }>;
}> {
  const market = await prisma.predictionMarket.findUnique({
    where: { id: marketId },
    include: { payouts: true },
  });
  if (!market) throw new Error("Market not found");
  if (market.status !== PredictionMarketStatus.RESOLVED) {
    throw new Error("Market is not resolved yet");
  }

  return {
    marketId: market.id,
    winningSide: market.winningSide,
    liquidityReturned: market.initialLiquidityAmount.toString(),
    payouts: market.payouts.map((p) => ({
      userId: p.userId,
      amount: p.amount.toString(),
      type: "winnings" as const,
    })),
  };
}
