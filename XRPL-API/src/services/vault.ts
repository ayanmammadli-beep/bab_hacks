import { v4 as uuid } from "uuid";
import { Wallet } from "xrpl";
import { store } from "../store";
import { Group, Member, GroupBalance, VotingWeights } from "../types";
import { createFundedWallet, getAccountBalance, getAccountTransactions, dropsToXrp } from "./xrpl";
import { setupGroupVault, depositToVault, withdrawFromVault, getVaultInfo } from "./sav";

export async function createGroup(
  name: string,
  threshold?: number
): Promise<Group> {
  const vaultWallet = await createFundedWallet();

  const group: Group = {
    id: uuid(),
    name,
    vaultWalletAddress: vaultWallet.address,
    vaultWalletSeed: vaultWallet.seed,
    threshold: threshold ?? parseFloat(process.env.DEFAULT_VOTE_THRESHOLD || "0.6"),
    members: [],
    createdAt: new Date().toISOString(),
  };

  // Set up Single Asset Vault (XLS-65)
  try {
    const wallet = Wallet.fromSeed(vaultWallet.seed);
    const sav = await setupGroupVault(wallet, name);
    group.mptIssuanceId = sav.mptIssuanceId;
    group.savVaultId = sav.vaultId;
    group.savVaultAccount = sav.vaultAccount;
    group.savShareMPTId = sav.shareMPTId;
    console.log(`SAV created for group "${name}": vault=${sav.vaultId}`);
  } catch (err: any) {
    console.warn(`SAV setup failed (group still works without it): ${err.message}`);
  }

  store.saveGroup(group);
  return group;
}

export function addMember(
  groupId: string,
  handle: string,
  xrplAddress: string
): Member {
  const group = store.getGroup(groupId);
  if (!group) throw new Error("Group not found");

  const existing = group.members.find(
    (m) => m.handle === handle || m.xrplAddress === xrplAddress
  );
  if (existing) throw new Error("Member already in group");

  const member: Member = {
    id: uuid(),
    handle,
    xrplAddress,
    destinationTag: store.getNextDestinationTag(groupId),
    depositedAmount: 0,
    createdAt: new Date().toISOString(),
  };

  group.members.push(member);
  store.saveGroup(group);
  return member;
}

export async function recordDeposit(
  groupId: string,
  memberId: string,
  amount: number
): Promise<{ member: Member; savTxHash?: string }> {
  const group = store.getGroup(groupId);
  if (!group) throw new Error("Group not found");

  const member = group.members.find((m) => m.id === memberId);
  if (!member) throw new Error("Member not found in group");

  member.depositedAmount += amount;
  store.saveGroup(group);

  // Mirror deposit into SAV on-chain
  let savTxHash: string | undefined;
  if (group.savVaultId && group.mptIssuanceId) {
    try {
      const wallet = Wallet.fromSeed(group.vaultWalletSeed);
      savTxHash = await depositToVault(
        wallet,
        group.savVaultId,
        group.mptIssuanceId,
        amount.toFixed(6)
      );
    } catch (err: any) {
      console.warn(`SAV deposit failed (in-memory still updated): ${err.message}`);
    }
  }

  return { member, savTxHash };
}

export async function recordWithdrawal(
  groupId: string,
  memberId: string,
  amount: number
): Promise<{ member: Member; savTxHash?: string }> {
  const group = store.getGroup(groupId);
  if (!group) throw new Error("Group not found");

  const member = group.members.find((m) => m.id === memberId);
  if (!member) throw new Error("Member not found in group");

  if (member.depositedAmount < amount) {
    throw new Error("Insufficient balance");
  }

  member.depositedAmount -= amount;
  store.saveGroup(group);

  // Mirror withdrawal from SAV on-chain
  let savTxHash: string | undefined;
  if (group.savVaultId && group.mptIssuanceId) {
    try {
      const wallet = Wallet.fromSeed(group.vaultWalletSeed);
      savTxHash = await withdrawFromVault(
        wallet,
        group.savVaultId,
        group.mptIssuanceId,
        amount.toFixed(6)
      );
    } catch (err: any) {
      console.warn(`SAV withdraw failed (in-memory still updated): ${err.message}`);
    }
  }

  return { member, savTxHash };
}

export async function getGroupVaultInfo(groupId: string): Promise<any> {
  const group = store.getGroup(groupId);
  if (!group) throw new Error("Group not found");
  if (!group.savVaultId) return { error: "No SAV configured for this group" };
  return getVaultInfo(group.savVaultId);
}

export function getTotalDeposited(groupId: string): number {
  const group = store.getGroup(groupId);
  if (!group) throw new Error("Group not found");
  return group.members.reduce((sum, m) => sum + m.depositedAmount, 0);
}

export function getVotingWeights(groupId: string): VotingWeights {
  const group = store.getGroup(groupId);
  if (!group) throw new Error("Group not found");

  const total = getTotalDeposited(groupId);
  const weights: VotingWeights = {};

  for (const member of group.members) {
    weights[member.id] = {
      handle: member.handle,
      deposited: member.depositedAmount,
      weight: total > 0 ? member.depositedAmount / total : 0,
    };
  }
  return weights;
}

/**
 * Scan recent on-chain transactions to the vault wallet and auto-credit any
 * member deposits identified by their DestinationTag.
 * Safe to call repeatedly — already-processed tx hashes are skipped.
 */
export async function detectDeposits(groupId: string): Promise<{
  detected: number;
  deposits: { txHash: string; memberId: string; handle: string; amount: number }[];
}> {
  const group = store.getGroup(groupId);
  if (!group) throw new Error("Group not found");

  const processedHashes: string[] = group.processedDepositHashes ?? [];

  // Build a quick lookup: destinationTag → member
  const tagToMember = new Map<number, Member>();
  for (const m of group.members) {
    tagToMember.set(m.destinationTag, m);
  }

  const txs = await getAccountTransactions(group.vaultWalletAddress, 50);
  const newDeposits: { txHash: string; memberId: string; handle: string; amount: number }[] = [];

  for (const entry of txs) {
    const tx = (entry as any).tx ?? (entry as any).transaction ?? entry;
    if (tx.TransactionType !== "Payment") continue;
    if (tx.Destination !== group.vaultWalletAddress) continue;

    const hash: string = tx.hash ?? (entry as any).hash;
    if (!hash || processedHashes.includes(hash)) continue;

    const tag: number | undefined = tx.DestinationTag;
    if (tag === undefined) continue;

    const member = tagToMember.get(tag);
    if (!member) continue;

    // Prefer delivered_amount from meta to handle partial payments
    const meta = (entry as any).meta ?? (entry as any).metaData;
    const rawAmount =
      (typeof meta === "object" && meta?.delivered_amount) ??
      (typeof meta === "object" && meta?.DeliveredAmount) ??
      tx.Amount;

    if (typeof rawAmount !== "string") continue; // skip IOU payments

    const amountXRP = Number(dropsToXrp(rawAmount));
    if (amountXRP <= 0) continue;

    await recordDeposit(groupId, member.id, amountXRP);
    processedHashes.push(hash);
    newDeposits.push({ txHash: hash, memberId: member.id, handle: member.handle, amount: amountXRP });
  }

  group.processedDepositHashes = processedHashes;
  store.saveGroup(group);

  return { detected: newDeposits.length, deposits: newDeposits };
}

export async function getGroupBalance(groupId: string): Promise<GroupBalance> {
  const group = store.getGroup(groupId);
  if (!group) throw new Error("Group not found");

  const xrpBalance = await getAccountBalance(group.vaultWalletAddress);
  const totalDeposited = getTotalDeposited(groupId);

  return {
    groupId: group.id,
    vaultAddress: group.vaultWalletAddress,
    totalDeposited,
    xrpBalance,
    members: group.members.map((m) => ({
      memberId: m.id,
      handle: m.handle,
      deposited: m.depositedAmount,
      sharePercent: totalDeposited > 0 ? (m.depositedAmount / totalDeposited) * 100 : 0,
    })),
  };
}
