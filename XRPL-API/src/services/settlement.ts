import { Wallet } from "xrpl";
import { store } from "../store";
import { SettlementResult } from "../types";
import { sendXRP } from "./xrpl";
import { finishEscrow, batchFinishEscrows } from "./escrow";

/**
 * Settle a single proposal after event resolution.
 * 1. Finish the escrow (releases locked funds back to vault wallet)
 * 2. Calculate each member's payout based on their share
 * 3. Distribute payouts to members' personal wallets
 */
export async function settleProposal(
  proposalId: string,
  outcome: "win" | "loss",
  returnMultiplier: number
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

  // Step 1: Finish escrow to release funds back to vault wallet
  await finishEscrow(escrow.id);

  // Step 2: Calculate payouts
  const tradeAmount = proposal.amount;
  const totalPayout = outcome === "win"
    ? tradeAmount * returnMultiplier
    : 0;

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
