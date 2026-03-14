import { Wallet } from "xrpl";
import { store } from "../store";
import { SettlementResult } from "../types";
import { sendXRP } from "./xrpl";
import { finishEscrow, batchFinishEscrows } from "./escrow";
import { liquidGetTicker, liquidGetOrder, isLiquidConfigured } from "./liquid";

/**
 * Compute P&L from Liquid if the proposal has a tracked order.
 * Returns the return multiplier (e.g. 1.18 for +18%).
 */
async function computeLiquidReturn(proposal: {
  liquidSymbol?: string;
  liquidEntryPrice?: number;
  liquidOrderId?: string;
  side: string;
}): Promise<number | null> {
  if (!proposal.liquidSymbol || !proposal.liquidEntryPrice || !isLiquidConfigured()) {
    return null;
  }
  try {
    const ticker = await liquidGetTicker(proposal.liquidSymbol);
    const currentPrice = Number(ticker.mark_price);
    const entryPrice = proposal.liquidEntryPrice;
    const isLong = proposal.side === "long" || proposal.side === "yes";
    const pnlPercent = isLong
      ? (currentPrice - entryPrice) / entryPrice
      : (entryPrice - currentPrice) / entryPrice;
    return 1 + pnlPercent;
  } catch (err: any) {
    console.warn(`Could not fetch Liquid P&L: ${err.message}`);
    return null;
  }
}

/**
 * Settle a single proposal after event resolution.
 * 1. Finish the escrow (releases locked funds back to vault wallet)
 * 2. Calculate each member's payout based on their share
 * 3. Distribute payouts to members' personal wallets
 *
 * If returnMultiplier is not provided and the proposal has a Liquid position,
 * the multiplier is computed from the current market price vs entry price.
 */
export async function settleProposal(
  proposalId: string,
  outcome: "win" | "loss",
  returnMultiplier?: number
): Promise<SettlementResult> {
  const proposal = store.getProposal(proposalId);
  if (!proposal) throw new Error("Proposal not found");
  if (proposal.status !== "executed") {
    throw new Error(`Proposal is ${proposal.status}, expected 'executed'`);
  }

  const group = store.getGroup(proposal.groupId);
  if (!group) throw new Error("Group not found");

  const escrow = store.getEscrowByProposal(proposalId);
  if (!escrow) throw new Error("No escrow found for this proposal");

  // Compute return from Liquid if not manually provided
  let multiplier = returnMultiplier ?? 1.0;
  if (returnMultiplier == null) {
    const liquidReturn = await computeLiquidReturn(proposal);
    if (liquidReturn !== null) {
      multiplier = liquidReturn;
      if (multiplier < 1) outcome = "loss";
    }
  }

  await finishEscrow(escrow.id);

  const tradeAmount = proposal.amount;
  const totalPayout = outcome === "win"
    ? tradeAmount * multiplier
    : tradeAmount * Math.max(0, multiplier);

  const totalDeposited = group.members.reduce((s, m) => s + m.depositedAmount, 0);
  const vaultWallet = Wallet.fromSeed(group.vaultWalletSeed);
  const memberPayouts: SettlementResult["memberPayouts"] = [];

  for (const member of group.members) {
    if (totalDeposited === 0) continue;
    const share = member.depositedAmount / totalDeposited;
    const payout = totalPayout * share;

    if (payout > 0) {
      try {
        const txHash = await sendXRP(
          vaultWallet,
          member.xrplAddress,
          payout.toFixed(6)
        );
        memberPayouts.push({
          memberId: member.id,
          handle: member.handle,
          amount: payout,
          txHash,
        });
      } catch (err: any) {
        memberPayouts.push({
          memberId: member.id,
          handle: member.handle,
          amount: payout,
          txHash: `ERROR: ${err.message}`,
        });
      }
    } else {
      memberPayouts.push({
        memberId: member.id,
        handle: member.handle,
        amount: 0,
      });
    }
  }

  proposal.status = "settled";
  store.saveProposal(proposal);

  return {
    proposalId,
    escrowSequence: escrow.sequence,
    outcome,
    totalPayout,
    memberPayouts,
  };
}

/**
 * Batch settle multiple proposals at once.
 * First releases all escrows, then distributes payouts.
 */
export async function batchSettle(
  settlements: { proposalId: string; outcome: "win" | "loss"; returnMultiplier: number }[]
): Promise<SettlementResult[]> {
  const results: SettlementResult[] = [];
  for (const s of settlements) {
    try {
      const result = await settleProposal(s.proposalId, s.outcome, s.returnMultiplier);
      results.push(result);
    } catch (err: any) {
      results.push({
        proposalId: s.proposalId,
        escrowSequence: 0,
        outcome: s.outcome,
        totalPayout: 0,
        memberPayouts: [{ memberId: "error", handle: err.message, amount: 0 }],
      });
    }
  }
  return results;
}
