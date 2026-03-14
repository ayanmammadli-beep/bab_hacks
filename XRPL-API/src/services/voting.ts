import { v4 as uuid } from "uuid";
import { store } from "../store";
import { Proposal, Vote } from "../types";
import { getVotingWeights } from "./vault";

const VOTE_WINDOW_MS =
  (parseInt(process.env.VOTE_WINDOW_MINUTES || "5", 10)) * 60 * 1000;

export function createProposal(params: {
  groupId: string;
  proposerId: string;
  type: "crypto" | "prediction";
  description: string;
  market: string;
  side: "long" | "short" | "yes" | "no";
  amount: number;
  quantity?: number;
}): Proposal {
  const group = store.getGroup(params.groupId);
  if (!group) throw new Error("Group not found");

  const member = group.members.find((m) => m.id === params.proposerId);
  if (!member) throw new Error("Proposer is not a member of this group");

  const totalDeposited = group.members.reduce((s, m) => s + m.depositedAmount, 0);
  if (params.amount > totalDeposited) {
    throw new Error("Trade amount exceeds group's total deposited funds");
  }

  const openProposals = store.getOpenProposalsByGroup(params.groupId);
  if (openProposals.length > 0) {
    throw new Error("Group already has an open proposal — vote or cancel it first");
  }

  const now = new Date();
  const proposal: Proposal = {
    id: uuid(),
    groupId: params.groupId,
    proposerId: params.proposerId,
    type: params.type,
    description: params.description,
    market: params.market,
    side: params.side,
    amount: params.amount,
    quantity: params.quantity,
    status: "open",
    votes: [],
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + VOTE_WINDOW_MS).toISOString(),
  };

  store.saveProposal(proposal);
  return proposal;
}

export function castVote(
  proposalId: string,
  memberId: string,
  vote: "yes" | "no"
): { proposal: Proposal; quorumReached: boolean; yesWeight: number; noWeight: number } {
  const proposal = store.getProposal(proposalId);
  if (!proposal) throw new Error("Proposal not found");
  if (proposal.status !== "open") {
    throw new Error(`Proposal is ${proposal.status}, cannot vote`);
  }

  if (new Date() > new Date(proposal.expiresAt)) {
    proposal.status = "rejected";
    store.saveProposal(proposal);
    throw new Error("Voting window has expired");
  }

  const group = store.getGroup(proposal.groupId);
  if (!group) throw new Error("Group not found");

  const member = group.members.find((m) => m.id === memberId);
  if (!member) throw new Error("Not a member of this group");

  const alreadyVoted = proposal.votes.find((v) => v.memberId === memberId);
  if (alreadyVoted) throw new Error("Member already voted on this proposal");

  const weights = getVotingWeights(proposal.groupId);
  const memberWeight = weights[memberId]?.weight ?? 0;
  if (memberWeight === 0) {
    throw new Error("Member has no voting weight (no deposits)");
  }

  const newVote: Vote = {
    memberId,
    memberHandle: member.handle,
    vote,
    weight: memberWeight,
    timestamp: new Date().toISOString(),
  };
  proposal.votes.push(newVote);

  const { yesWeight, noWeight } = tallyVotes(proposal);

  const quorumReached = yesWeight >= group.threshold;
  if (quorumReached) {
    proposal.status = "approved";
  } else if (noWeight > 1 - group.threshold) {
    proposal.status = "rejected";
  }

  store.saveProposal(proposal);
  return { proposal, quorumReached, yesWeight, noWeight };
}

export function tallyVotes(proposal: Proposal): {
  yesWeight: number;
  noWeight: number;
  totalVoted: number;
} {
  let yesWeight = 0;
  let noWeight = 0;
  for (const v of proposal.votes) {
    if (v.vote === "yes") yesWeight += v.weight;
    else noWeight += v.weight;
  }
  return { yesWeight, noWeight, totalVoted: proposal.votes.length };
}

export function expireStaleProposals(): number {
  let expired = 0;
  const now = new Date();
  for (const group of store.getAllGroups()) {
    for (const proposal of store.getOpenProposalsByGroup(group.id)) {
      if (now > new Date(proposal.expiresAt)) {
        proposal.status = "rejected";
        store.saveProposal(proposal);
        expired++;
      }
    }
  }
  return expired;
}
