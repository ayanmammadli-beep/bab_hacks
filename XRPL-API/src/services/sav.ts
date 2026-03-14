import { Wallet, convertStringToHex, encodeMPTokenMetadata, VaultWithdrawalPolicy } from "xrpl";
import { getClient } from "./xrpl";

/**
 * Single Asset Vault (XLS-65) service.
 *
 * Flow:
 * 1. createMPTIssuance — vault owner creates a Multi-Purpose Token representing fund units
 * 2. createVault — vault owner creates an SAV backed by that MPT
 * 3. depositToVault / withdrawFromVault — manages on-chain fund state
 */

function txSuccess(meta: any): boolean {
  return (
    typeof meta === "object" &&
    meta !== null &&
    "TransactionResult" in meta &&
    meta.TransactionResult === "tesSUCCESS"
  );
}

// --- MPT Issuance ---

export async function createMPTIssuance(
  wallet: Wallet,
  groupName: string
): Promise<string> {
  const client = await getClient();

  const tx: any = {
    TransactionType: "MPTokenIssuanceCreate",
    Account: wallet.address,
    AssetScale: 6,
    // Allow transfers + trading so members can hold and vault can accept
    Flags: 0x20 | 0x10, // tfMPTCanTransfer | tfMPTCanTrade
    MPTokenMetadata: convertStringToHex(
      JSON.stringify({ name: `STRAITS-${groupName}`, desc: "Group fund token" })
    ),
  };

  const prepared = await client.autofill(tx);
  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  if (!txSuccess(result.result.meta)) {
    throw new Error(`MPTokenIssuanceCreate failed: ${(result.result.meta as any)?.TransactionResult}`);
  }

  // Extract MPTokenIssuanceID from affected nodes
  const meta = result.result.meta as any;
  const nodes: any[] = meta.AffectedNodes || [];
  const issuanceNode = nodes.find(
    (n: any) => n.CreatedNode?.LedgerEntryType === "MPTokenIssuance"
  );
  if (!issuanceNode) {
    throw new Error("Could not find MPTokenIssuance in tx metadata");
  }
  return issuanceNode.CreatedNode.LedgerIndex as string;
}

// --- Single Asset Vault ---

export interface SAVInfo {
  vaultId: string;
  vaultAccount: string;
  shareMPTId: string;
}

export async function createVault(
  wallet: Wallet,
  mptIssuanceId: string,
  groupName: string
): Promise<SAVInfo> {
  const client = await getClient();

  const tx: any = {
    TransactionType: "VaultCreate",
    Account: wallet.address,
    Asset: { mpt_issuance_id: mptIssuanceId },
    Data: convertStringToHex(
      JSON.stringify({ n: `STRAITS ${groupName}`, t: "group-fund" })
    ),
    MPTokenMetadata: encodeMPTokenMetadata({
      ticker: "SFUND",
      name: `${groupName} Shares`,
      desc: `Proportional ownership shares of the ${groupName} fund vault.`,
      icon: "straits.fund/icon.png",
      asset_class: "defi",
      issuer_name: "STRAITS",
    }),
    AssetsMaximum: "0",
    WithdrawalPolicy: VaultWithdrawalPolicy.vaultStrategyFirstComeFirstServe,
  };

  const prepared = await client.autofill(tx);
  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  if (!txSuccess(result.result.meta)) {
    throw new Error(`VaultCreate failed: ${(result.result.meta as any)?.TransactionResult}`);
  }

  const meta = result.result.meta as any;
  const nodes: any[] = meta.AffectedNodes || [];
  const vaultNode = nodes.find(
    (n: any) => n.CreatedNode?.LedgerEntryType === "Vault"
  );
  if (!vaultNode) {
    throw new Error("Could not find Vault in tx metadata");
  }

  return {
    vaultId: vaultNode.CreatedNode.LedgerIndex,
    vaultAccount: vaultNode.CreatedNode.NewFields.Account,
    shareMPTId: vaultNode.CreatedNode.NewFields.ShareMPTID,
  };
}

// --- Deposit / Withdraw ---

export async function depositToVault(
  wallet: Wallet,
  vaultId: string,
  mptIssuanceId: string,
  amount: string
): Promise<string> {
  const client = await getClient();

  const tx: any = {
    TransactionType: "VaultDeposit",
    Account: wallet.address,
    VaultID: vaultId,
    Amount: { mpt_issuance_id: mptIssuanceId, value: amount },
  };

  const prepared = await client.autofill(tx);
  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  if (!txSuccess(result.result.meta)) {
    throw new Error(`VaultDeposit failed: ${(result.result.meta as any)?.TransactionResult}`);
  }

  return result.result.hash;
}

export async function withdrawFromVault(
  wallet: Wallet,
  vaultId: string,
  mptIssuanceId: string,
  amount: string
): Promise<string> {
  const client = await getClient();

  const tx: any = {
    TransactionType: "VaultWithdraw",
    Account: wallet.address,
    VaultID: vaultId,
    Amount: { mpt_issuance_id: mptIssuanceId, value: amount },
  };

  const prepared = await client.autofill(tx);
  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  if (!txSuccess(result.result.meta)) {
    throw new Error(`VaultWithdraw failed: ${(result.result.meta as any)?.TransactionResult}`);
  }

  return result.result.hash;
}

// --- Vault info ---

export async function getVaultInfo(vaultId: string): Promise<any> {
  const client = await getClient();
  const response = await client.request({
    command: "vault_info",
    vault_id: vaultId,
    ledger_index: "validated",
  } as any);
  return response.result;
}

// --- Full setup helper (MPT + SAV in one call) ---

export async function setupGroupVault(
  wallet: Wallet,
  groupName: string
): Promise<{ mptIssuanceId: string } & SAVInfo> {
  const mptIssuanceId = await createMPTIssuance(wallet, groupName);
  const sav = await createVault(wallet, mptIssuanceId, groupName);
  return { mptIssuanceId, ...sav };
}
