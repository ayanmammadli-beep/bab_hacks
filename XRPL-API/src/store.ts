import { Group, Proposal, EscrowRecord } from "./types";

class Store {
  private groups: Map<string, Group> = new Map();
  private proposals: Map<string, Proposal> = new Map();
  private escrows: Map<string, EscrowRecord> = new Map();
  private nextDestinationTag: Map<string, number> = new Map();

  // --- Groups ---

  getGroup(id: string): Group | undefined {
    return this.groups.get(id);
  }

  getAllGroups(): Group[] {
    return Array.from(this.groups.values());
  }

  saveGroup(group: Group): void {
    this.groups.set(group.id, group);
  }

  deleteGroup(id: string): boolean {
    return this.groups.delete(id);
  }

  getNextDestinationTag(groupId: string): number {
    const current = this.nextDestinationTag.get(groupId) ?? 1;
    this.nextDestinationTag.set(groupId, current + 1);
    return current;
  }

  // --- Proposals ---

  getProposal(id: string): Proposal | undefined {
    return this.proposals.get(id);
  }

  getProposalsByGroup(groupId: string): Proposal[] {
    return Array.from(this.proposals.values()).filter(
      (p) => p.groupId === groupId
    );
  }

  getOpenProposalsByGroup(groupId: string): Proposal[] {
    return this.getProposalsByGroup(groupId).filter(
      (p) => p.status === "open"
    );
  }

  saveProposal(proposal: Proposal): void {
    this.proposals.set(proposal.id, proposal);
  }

  // --- Escrows ---

  getEscrow(id: string): EscrowRecord | undefined {
    return this.escrows.get(id);
  }

  getEscrowByProposal(proposalId: string): EscrowRecord | undefined {
    return Array.from(this.escrows.values()).find(
      (e) => e.proposalId === proposalId
    );
  }

  getActiveEscrowsByGroup(groupId: string): EscrowRecord[] {
    return Array.from(this.escrows.values()).filter(
      (e) => e.groupId === groupId && e.status === "active"
    );
  }

  saveEscrow(escrow: EscrowRecord): void {
    this.escrows.set(escrow.id, escrow);
  }
}

export const store = new Store();
