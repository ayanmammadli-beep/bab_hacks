import { Client, Wallet, xrpToDrops, dropsToXrp } from "xrpl";

let client: Client | null = null;
let masterWallet: Wallet | null = null;

export async function getClient(): Promise<Client> {
  if (client && client.isConnected()) return client;
  const url = process.env.XRPL_WSS_URL || "wss://s.altnet.rippletest.net:51233";
  client = new Client(url, { connectionTimeout: 30000 });
  await client.connect();
  return client;
}

export function getMasterWallet(): Wallet {
  if (masterWallet) return masterWallet;
  const seed = process.env.XRPL_MASTER_SEED;
  if (!seed) throw new Error("XRPL_MASTER_SEED not configured");
  masterWallet = Wallet.fromSeed(seed);
  return masterWallet;
}

export async function fundWalletFromFaucet(): Promise<Wallet> {
  const c = await getClient();
  const { wallet } = await c.fundWallet();
  return wallet;
}

export async function createFundedWallet(): Promise<{
  address: string;
  seed: string;
}> {
  const wallet = await fundWalletFromFaucet();
  return { address: wallet.address, seed: wallet.seed! };
}

export async function getAccountBalance(address: string): Promise<string> {
  const c = await getClient();
  try {
    const response = await c.request({
      command: "account_info",
      account: address,
      ledger_index: "validated",
    });
    return String(dropsToXrp(response.result.account_data.Balance as string));
  } catch {
    return "0";
  }
}

export async function sendXRP(
  fromWallet: Wallet,
  destination: string,
  amountXRP: string,
  destinationTag?: number
): Promise<string> {
  const c = await getClient();
  const tx: any = {
    TransactionType: "Payment",
    Account: fromWallet.address,
    Destination: destination,
    Amount: xrpToDrops(amountXRP),
  };
  if (destinationTag !== undefined) {
    tx.DestinationTag = destinationTag;
  }

  const prepared = await c.autofill(tx);
  const signed = fromWallet.sign(prepared);
  const result = await c.submitAndWait(signed.tx_blob);

  const meta = result.result.meta;
  if (
    typeof meta === "object" &&
    meta !== null &&
    "TransactionResult" in meta &&
    meta.TransactionResult !== "tesSUCCESS"
  ) {
    throw new Error(`Payment failed: ${meta.TransactionResult}`);
  }
  return result.result.hash;
}

export async function getAccountTransactions(
  address: string,
  limit = 20
): Promise<any[]> {
  const c = await getClient();
  const response = await c.request({
    command: "account_tx",
    account: address,
    limit,
    ledger_index_min: -1,
    ledger_index_max: -1,
  });
  return response.result.transactions || [];
}

export async function disconnect(): Promise<void> {
  if (client?.isConnected()) {
    await client.disconnect();
    client = null;
  }
}

export { Wallet, xrpToDrops, dropsToXrp };
