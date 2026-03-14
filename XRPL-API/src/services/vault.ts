import { v4 as uuid } from "uuid";
import { store } from "../store";
import { Group, Member, GroupBalance, VotingWeights } from "../types";
import { createFundedWallet, getAccountBalance } from "./xrpl";

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

export function recordDeposit(
  groupId: string,
  memberId: string,
  amount: number
): Member {
  const group = store.getGroup(groupId);
  if (!group) throw new Error("Group not found");

  const member = group.members.find((m) => m.id === memberId);
  if (!member) throw new Error("Member not found in group");

  member.depositedAmount += amount;
  store.saveGroup(group);
  return member;
}

export function recordWithdrawal(
  groupId: string,
  memberId: string,
  amount: number
): Member {
  const group = store.getGroup(groupId);
  if (!group) throw new Error("Group not found");

  const member = group.members.find((m) => m.id === memberId);
  if (!member) throw new Error("Member not found in group");

  if (member.depositedAmount < amount) {
    throw new Error("Insufficient balance");
  }

  member.depositedAmount -= amount;
  store.saveGroup(group);
  return member;
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
