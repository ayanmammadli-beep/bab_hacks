export interface Group {
  id: string;
  name: string;
  vaultWalletAddress: string;
  vaultWalletSeed: string;
  threshold: number;
  members: Member[];
  createdAt: string;
  // Single Asset Vault (XLS-65)
  mptIssuanceId?: string;
  savVaultId?: string;
  savVaultAccount?: string;
  savShareMPTId?: string;
  // On-chain deposit tracking
  processedDepositHashes?: string[];
}

export interface Member { // member of groupchat
  id: string;
  handle: string;
  xrplAddress: string;
  destinationTag: number;
  depositedAmount: number;
  createdAt: string;
}

export interface Proposal { // trade proposal 
  id: string;
  groupId: string;
  proposerId: string;
  type: "crypto" | "prediction";
  description: string;
  market: string;
  side: "long" | "short" | "yes" | "no";
  amount: number;
  status: "open" | "approved" | "rejected" | "executed" | "settled" | "cancelled";
  votes: Vote[];
  quantity?: number;
  escrowSequence?: number;
  escrowCondition?: string;
  escrowFulfillment?: string;
  liquidOrderId?: string;
  liquidSymbol?: string;
  liquidEntryPrice?: number;
  createdAt: string;
  expiresAt: string;
}

export interface Vote {
  memberId: string;
  memberHandle: string;
  vote: "yes" | "no";
  weight: number;
  timestamp: string;
}

export interface EscrowRecord {
  id: string;
  groupId: string;
  proposalId: string;
  ownerAddress: string;
  sequence: number;
  amount: string;
  condition: string;
  fulfillment: string;
  status: "active" | "finished" | "cancelled";
  createdAt: string;
}

export interface VotingWeights {
  [memberId: string]: {
    handle: string;
    deposited: number;
    weight: number;
  };
}

export interface GroupBalance {
  groupId: string;
  vaultAddress: string;
  totalDeposited: number;
  xrpBalance: string;
  members: {
    memberId: string;
    handle: string;
    deposited: number;
    sharePercent: number;
  }[];
}

export interface SettlementResult {
  proposalId: string;
  escrowSequence: number;
  outcome: "win" | "loss";
  totalPayout: number;
  memberPayouts: {
    memberId: string;
    handle: string;
    amount: number;
    txHash?: string;
  }[];
}
