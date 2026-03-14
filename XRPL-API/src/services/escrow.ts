import crypto from "crypto";
import { v4 as uuid } from "uuid";
import { Wallet, xrpToDrops } from "xrpl";
import cc from "five-bells-condition";
import { store } from "../store";
import { EscrowRecord } from "../types";
import { getClient } from "./xrpl";

export function generateConditionPair(): {
  condition: string;
  fulfillment: string;
} {
  const preimage = crypto.randomBytes(32);
  const fulfillmentObj = new cc.PreimageSha256();
  fulfillmentObj.setPreimage(preimage);

  const fulfillment = fulfillmentObj.serializeBinary().toString("hex").toUpperCase();
  const condition = fulfillmentObj.getConditionBinary().toString("hex").toUpperCase();

  return { condition, fulfillment };
}

export async function createEscrow(params: {
  groupId: string;
  proposalId: string;
  amountXRP: string;
  releaseDateISO?: string;
}): Promise<EscrowRecord> {
  const group = store.getGroup(params.groupId);
  if (!group) throw new Error("Group not found");

  const { condition, fulfillment } = generateConditionPair();
  const client = await getClient();
  const vaultWallet = Wallet.fromSeed(group.vaultWalletSeed);

  // CancelAfter = 7 days from now (safety net to reclaim if never settled)
  const cancelAfter = rippleEpoch(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

  const tx: any = {
    TransactionType: "EscrowCreate",
    Account: vaultWallet.address,
    Destination: vaultWallet.address,
    Amount: xrpToDrops(params.amountXRP),
    Condition: condition,
    CancelAfter: cancelAfter,
  };

  const prepared = await client.autofill(tx);
  const signed = vaultWallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  const meta = result.result.meta;
  if (
    typeof meta === "object" &&
    meta !== null &&
    "TransactionResult" in meta &&
    meta.TransactionResult !== "tesSUCCESS"
  ) {
    throw new Error(`EscrowCreate failed: ${meta.TransactionResult}`);
  }

  const escrowSequence = (result.result as any).Sequence ??
    (typeof meta === "object" && meta !== null && "Sequence" in (result.result as any)
      ? (result.result as any).Sequence
      : prepared.Sequence);

  const record: EscrowRecord = {
    id: uuid(),
    groupId: params.groupId,
    proposalId: params.proposalId,
    ownerAddress: vaultWallet.address,
    sequence: escrowSequence!,
    amount: params.amountXRP,
    condition,
    fulfillment,
    status: "active",
    createdAt: new Date().toISOString(),
  };

  store.saveEscrow(record);

  const proposal = store.getProposal(params.proposalId);
  if (proposal) {
    proposal.escrowSequence = escrowSequence;
    proposal.escrowCondition = condition;
    proposal.escrowFulfillment = fulfillment;
    proposal.status = "executed";
    store.saveProposal(proposal);
  }

  return record;
}

export async function finishEscrow(escrowId: string): Promise<{
  txHash: string;
  escrow: EscrowRecord;
}> {
  const escrow = store.getEscrow(escrowId);
  if (!escrow) throw new Error("Escrow not found");
  if (escrow.status !== "active") throw new Error("Escrow is not active");

  const group = store.getGroup(escrow.groupId);
  if (!group) throw new Error("Group not found");

  const client = await getClient();
  const vaultWallet = Wallet.fromSeed(group.vaultWalletSeed);

  const tx: any = {
    TransactionType: "EscrowFinish",
    Account: vaultWallet.address,
    Owner: escrow.ownerAddress,
    OfferSequence: escrow.sequence,
    Condition: escrow.condition,
    Fulfillment: escrow.fulfillment,
  };

  const prepared = await client.autofill(tx);
  const signed = vaultWallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  const meta = result.result.meta;
  if (
    typeof meta === "object" &&
    meta !== null &&
    "TransactionResult" in meta &&
    meta.TransactionResult !== "tesSUCCESS"
  ) {
    throw new Error(`EscrowFinish failed: ${meta.TransactionResult}`);
  }

  escrow.status = "finished";
  store.saveEscrow(escrow);

  return { txHash: result.result.hash, escrow };
}

export async function cancelEscrow(escrowId: string): Promise<{
  txHash: string;
  escrow: EscrowRecord;
}> {
  const escrow = store.getEscrow(escrowId);
  if (!escrow) throw new Error("Escrow not found");
  if (escrow.status !== "active") throw new Error("Escrow is not active");

  const group = store.getGroup(escrow.groupId);
  if (!group) throw new Error("Group not found");

  const client = await getClient();
  const vaultWallet = Wallet.fromSeed(group.vaultWalletSeed);

  const tx: any = {
    TransactionType: "EscrowCancel",
    Account: vaultWallet.address,
    Owner: escrow.ownerAddress,
    OfferSequence: escrow.sequence,
  };

  const prepared = await client.autofill(tx);
  const signed = vaultWallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  escrow.status = "cancelled";
  store.saveEscrow(escrow);

  return { txHash: result.result.hash, escrow };
}

export async function batchFinishEscrows(escrowIds: string[]): Promise<{
  results: { escrowId: string; txHash?: string; error?: string }[];
}> {
  const results: { escrowId: string; txHash?: string; error?: string }[] = [];

  for (const id of escrowIds) {
    try {
      const { txHash } = await finishEscrow(id);
      results.push({ escrowId: id, txHash });
    } catch (err: any) {
      results.push({ escrowId: id, error: err.message });
    }
  }

  return { results };
}

function rippleEpoch(date: Date): number {
  return Math.floor(date.getTime() / 1000) - 946684800;
}
