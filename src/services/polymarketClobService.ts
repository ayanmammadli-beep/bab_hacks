import { ClobClient, Side, OrderType } from "@polymarket/clob-client";
import { Wallet } from "ethers";
import { config } from "../config.js";
import { getMarketById, getMarketOrderParams, type GammaMarket } from "./polymarketService.js";

const CLOB_HOST = config.polymarket.clobHost;
const CHAIN_ID = config.polymarket.chainId;

export interface ExecuteOrderParams {
  privateKey: string;
  marketId: string;
  tokenId: string;
  amountUsd: number;
  price: number;
}

export interface ExecuteOrderResult {
  success: boolean;
  txHash?: string;
  orderId?: string;
  error?: string;
}

/**
 * Execute a buy order on Polymarket CLOB using the group wallet.
 */
export async function executeBuyOrder(params: ExecuteOrderParams): Promise<ExecuteOrderResult> {
  const { privateKey, marketId, tokenId, amountUsd, price } = params;
  const market = await getMarketById(marketId);
  if (!market) return { success: false, error: "Market not found" };

  const orderParams = getMarketOrderParams(market);
  const size = amountUsd / price;
  if (size <= 0) return { success: false, error: "Invalid size" };

  const signer = new Wallet(privateKey);
  const tempClient = new ClobClient(CLOB_HOST, CHAIN_ID, signer);
  let apiCreds;
  try {
    apiCreds = await tempClient.createOrDeriveApiKey();
  } catch (e) {
    return {
      success: false,
      error: `Failed to derive API key: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const client = new ClobClient(
    CLOB_HOST,
    CHAIN_ID,
    signer,
    apiCreds,
    0,
    signer.address
  );

  try {
    const response = await client.createAndPostOrder(
      {
        tokenID: tokenId,
        price: Math.round(price * 100) / 100,
        side: Side.BUY,
        size,
      },
      { tickSize: orderParams.tickSize, negRisk: orderParams.negRisk },
      OrderType.GTC
    );
    const orderId = (response as { orderID?: string })?.orderID;
    const txHash = (response as { transactionHash?: string })?.transactionHash;
    return {
      success: true,
      orderId,
      txHash: txHash ?? orderId,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export interface ExecuteSellParams {
  privateKey: string;
  marketId: string;
  tokenId: string;
  shares: number;
  price: number;
}

/**
 * Execute a sell order (e.g. to close a position).
 */
export async function executeSellOrder(params: ExecuteSellParams): Promise<ExecuteOrderResult> {
  const { privateKey, marketId, tokenId, shares, price } = params;
  const market = await getMarketById(marketId);
  if (!market) return { success: false, error: "Market not found" };

  const orderParams = getMarketOrderParams(market);
  if (shares <= 0) return { success: false, error: "Invalid shares" };

  const signer = new Wallet(privateKey);
  const tempClient = new ClobClient(CLOB_HOST, CHAIN_ID, signer);
  let apiCreds;
  try {
    apiCreds = await tempClient.createOrDeriveApiKey();
  } catch (e) {
    return {
      success: false,
      error: `Failed to derive API key: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const client = new ClobClient(
    CLOB_HOST,
    CHAIN_ID,
    signer,
    apiCreds,
    0,
    signer.address
  );

  try {
    const response = await client.createAndPostOrder(
      {
        tokenID: tokenId,
        price: Math.round(price * 100) / 100,
        side: Side.SELL,
        size: shares,
      },
      { tickSize: orderParams.tickSize, negRisk: orderParams.negRisk },
      OrderType.GTC
    );
    const orderId = (response as { orderID?: string })?.orderID;
    const txHash = (response as { transactionHash?: string })?.transactionHash;
    return {
      success: true,
      orderId,
      txHash: txHash ?? orderId,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
