import { PrismaClient, ProposalStatus, PositionStatus } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { config } from "../config.js";
import { getOrCreateWallet, getDecryptedPrivateKey, deductUsdcBalance } from "./walletService.js";
import {
  getMarketById,
  getTokenIdForSide,
  getOutcomeByTokenId,
  getCurrentPriceForToken,
} from "./polymarketService.js";
import { executeBuyOrder, executeSellOrder } from "./polymarketClobService.js";

const prisma = new PrismaClient();

const DEFAULT_APPROVAL = config.voting.defaultApprovalWeight;

function toNum(d: Decimal | number): number {
  if (typeof d === "number") return d;
  return Number(d);
}

export async function createProposal(params: {
  groupChatId: string;
  marketId: string;
  amount: number;
  proposer: string;
  /**
   * Optional explicit outcome token id. Use this for multi-outcome markets.
   */
  outcomeTokenId?: string;
  /**
   * Optional human-readable outcome label.
   */
  outcomeLabel?: string;
  /**
   * Optional binary side for YES/NO markets.
   */
  side?: "YES" | "NO";
}): Promise<{ id: string; status: string; deadline: Date }> {
  await getOrCreateWallet(params.groupChatId);

  const market = await getMarketById(params.marketId);
  if (!market) throw new Error("Market not found");

  // Resolve which outcome token this proposal refers to.
  let tokenId = params.outcomeTokenId;
  if (!tokenId && params.side) {
    tokenId = getTokenIdForSide(market, params.side) ?? undefined;
  }
  if (!tokenId) {
    throw new Error("Outcome token not specified or could not be resolved for this market");
  }

  const outcome = getOutcomeByTokenId(market, tokenId);
  const outcomeLabel = params.outcomeLabel ?? outcome?.outcome ?? params.side ?? "UNKNOWN";

  const endDate = market.end_date_iso ? new Date(market.end_date_iso) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const deadline = endDate;

  const proposalData: any = {
    groupChatId: params.groupChatId,
    marketId: params.marketId,
    // store empty string when not a binary market to satisfy older typings
    side: params.side ?? "",
    outcomeTokenId: tokenId,
    outcomeLabel,
    amount: new Decimal(params.amount),
    proposer: params.proposer,
    status: ProposalStatus.VOTING,
    deadline,
  };

  const proposal = await prisma.proposal.create({
    data: proposalData,
  });

  return {
    id: proposal.id,
    status: proposal.status,
    deadline: proposal.deadline,
  };
}

export async function listProposals(groupChatId: string): Promise<
  Array<{
    id: string;
    marketId: string;
    side: string | null;
    outcomeTokenId: string | null;
    outcomeLabel: string | null;
    amount: string;
    proposer: string;
    approvalWeight: string;
    rejectWeight: string;
    status: string;
    deadline: Date;
    createdAt: Date;
  }>
> {
  await expireProposals(groupChatId);

  const list = await prisma.proposal.findMany({
    where: { groupChatId },
    orderBy: { createdAt: "desc" },
    include: { votes: true },
  });

  return list.map((p) => {
    const anyP: any = p;
    return {
      id: p.id,
      marketId: p.marketId,
      side: p.side,
      outcomeTokenId: anyP.outcomeTokenId ?? null,
      outcomeLabel: anyP.outcomeLabel ?? null,
      amount: p.amount.toString(),
      proposer: p.proposer,
      approvalWeight: p.approvalWeight.toString(),
      rejectWeight: p.rejectWeight.toString(),
      status: p.status,
      deadline: p.deadline,
      createdAt: p.createdAt,
    };
  });
}

async function expireProposals(groupChatId: string): Promise<void> {
  const now = new Date();
  await prisma.proposal.updateMany({
    where: {
      groupChatId,
      status: ProposalStatus.VOTING,
      deadline: { lt: now },
    },
    data: { status: ProposalStatus.EXPIRED },
  });
}

export async function voteOnProposal(
  proposalId: string,
  params: { userId: string; vote: "approve" | "reject"; weight?: number }
): Promise<{ approvalWeight: number; rejectWeight: number }> {
  const weight = params.weight ?? 1;
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    include: { votes: true },
  });
  if (!proposal) throw new Error("Proposal not found");
  if (proposal.status !== ProposalStatus.VOTING) throw new Error("Proposal is not in voting");

  await prisma.vote.upsert({
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

  const votes = await prisma.vote.findMany({ where: { proposalId } });
  let approvalWeight = 0;
  let rejectWeight = 0;
  for (const v of votes) {
    const w = toNum(v.weight);
    if (v.vote === "approve") approvalWeight += w;
    else rejectWeight += w;
  }

  await prisma.proposal.update({
    where: { id: proposalId },
    data: {
      approvalWeight: new Decimal(approvalWeight),
      rejectWeight: new Decimal(rejectWeight),
    },
  });

  return { approvalWeight, rejectWeight };
}

export async function executeProposal(proposalId: string): Promise<{
  status: "executed" | "rejected" | "expired" | "insufficient_approval";
  txHash?: string;
  positionId?: string;
}> {
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
  });
  if (!proposal) throw new Error("Proposal not found");

  if (proposal.status === ProposalStatus.EXPIRED) {
    return { status: "expired" };
  }
  if (proposal.status === ProposalStatus.REJECTED) {
    return { status: "rejected" };
  }
  if (proposal.status === ProposalStatus.EXECUTED) {
    const pos = await prisma.position.findFirst({
      where: { groupChatId: proposal.groupChatId, marketId: proposal.marketId, status: PositionStatus.OPEN },
    });
    return {
      status: "executed",
      txHash: pos?.txHash ?? undefined,
      positionId: pos?.id,
    };
  }
  if (proposal.status !== ProposalStatus.VOTING && proposal.status !== ProposalStatus.APPROVED) {
    return { status: "rejected" };
  }

  const now = new Date();
  if (proposal.deadline < now) {
    await prisma.proposal.update({
      where: { id: proposalId },
      data: { status: ProposalStatus.EXPIRED },
    });
    return { status: "expired" };
  }

  const approval = toNum(proposal.approvalWeight);
  const threshold = DEFAULT_APPROVAL;
  if (approval < threshold) {
    return { status: "insufficient_approval" };
  }

  // Check the group's Polygon wallet has enough USDC before placing any trade.
  const wallet = await prisma.wallet.findUnique({ where: { groupChatId: proposal.groupChatId } });
  const tradeAmount = toNum(proposal.amount);
  if (!wallet || Number(wallet.usdcBalance) < tradeAmount) {
    const have = wallet ? Number(wallet.usdcBalance) : 0;
    throw new Error(`Insufficient USDC balance: wallet has ${have} USDC, proposal requires ${tradeAmount} USDC. Fund the wallet first via POST /wallets/:groupChatId/fund`);
  }

  const anyProposal: any = proposal;
  const market = await getMarketById(proposal.marketId);
  if (!market) throw new Error("Market not found");
  let tokenId = anyProposal.outcomeTokenId ?? undefined;
  if (!tokenId && proposal.side) {
    tokenId = getTokenIdForSide(market, proposal.side as "YES" | "NO") ?? undefined;
  }
  if (!tokenId) {
    throw new Error("Outcome token for proposal could not be resolved");
  }
  const price = getCurrentPriceForToken(market, tokenId) || 0.5;

  const privateKey = await getDecryptedPrivateKey(proposal.groupChatId);
  const result = await executeBuyOrder({
    privateKey,
    marketId: proposal.marketId,
    tokenId,
    amountUsd: toNum(proposal.amount),
    price,
  });

  if (!result.success) {
    throw new Error(result.error ?? "Trade execution failed");
  }

  // Deduct USDC from the wallet's tracked balance now that the trade went through.
  await deductUsdcBalance(proposal.groupChatId, tradeAmount);

  const amountNum = toNum(proposal.amount);
  const shares = amountNum / price;

  const positionData: any = {
    groupChatId: proposal.groupChatId,
    marketId: proposal.marketId,
    side: proposal.side ?? "",
    outcomeTokenId: tokenId,
    outcomeLabel: anyProposal.outcomeLabel ?? null,
    shares: new Decimal(shares),
    avgPrice: new Decimal(price),
    currentPrice: new Decimal(price),
    status: PositionStatus.OPEN,
    txHash: result.txHash ?? undefined,
  };

  const position = await prisma.position.create({
    data: positionData,
  });

  await prisma.proposal.update({
    where: { id: proposalId },
    data: { status: ProposalStatus.EXECUTED },
  });

  return {
    status: "executed",
    txHash: result.txHash,
    positionId: position.id,
  };
}

export async function listPositions(groupChatId: string): Promise<
  Array<{
    id: string;
    marketId: string;
    side: string | null;
    outcomeTokenId: string | null;
    outcomeLabel: string | null;
    shares: string;
    avgPrice: string;
    currentPrice: string;
    status: string;
    executedAt: Date;
    closedAt: Date | null;
    txHash: string | null;
  }>
> {
  const list = await prisma.position.findMany({
    where: { groupChatId },
    orderBy: { executedAt: "desc" },
  });
  return list.map((p) => {
    const anyP: any = p;
    return {
      id: p.id,
      marketId: p.marketId,
      side: p.side,
      outcomeTokenId: anyP.outcomeTokenId ?? null,
      outcomeLabel: anyP.outcomeLabel ?? null,
      shares: p.shares.toString(),
      avgPrice: p.avgPrice.toString(),
      currentPrice: p.currentPrice.toString(),
      status: p.status,
      executedAt: p.executedAt,
      closedAt: p.closedAt,
      txHash: p.txHash,
    };
  });
}

export async function closePosition(
  positionId: string,
  _userId: string
): Promise<{
  status: "closed";
  positionId: string;
  marketId: string;
  txHash: string;
  closedAt: Date;
}> {
  const position = await prisma.position.findUnique({
    where: { id: positionId },
  });
  if (!position) throw new Error("Position not found");
  if (position.status === PositionStatus.CLOSED) throw new Error("Position already closed");

  const privateKey = await getDecryptedPrivateKey(position.groupChatId);
  const market = await getMarketById(position.marketId);
  if (!market) throw new Error("Market not found");
  const anyPosition: any = position;
  let tokenId = anyPosition.outcomeTokenId ?? undefined;
  if (!tokenId && position.side) {
    tokenId = getTokenIdForSide(market, position.side as "YES" | "NO") ?? undefined;
  }
  if (!tokenId) {
    throw new Error("Outcome token for position could not be resolved");
  }
  const price = getCurrentPriceForToken(market, tokenId) || 0.5;

  const result = await executeSellOrder({
    privateKey,
    marketId: position.marketId,
    tokenId,
    shares: toNum(position.shares),
    price,
  });

  if (!result.success) {
    throw new Error(result.error ?? "Exit order failed");
  }

  const closedAt = new Date();
  await prisma.position.update({
    where: { id: positionId },
    data: {
      status: PositionStatus.CLOSED,
      closedAt,
      currentPrice: new Decimal(price),
      txHash: result.txHash ?? position.txHash,
    },
  });

  return {
    status: "closed",
    positionId: position.id,
    marketId: position.marketId,
    txHash: result.txHash ?? "",
    closedAt,
  };
}
