import { liquidFetch, parseResponse } from "./client.js";

export interface Product {
  symbol: string;
  ticker?: string;
  exchange?: string;
  max_leverage?: number;
  sz_decimals?: number;
  [key: string]: unknown;
}

export interface Ticker {
  mark_price: string | number;
  volume_24h?: string | number;
  change_24h?: string | number;
  funding_rate?: string | number;
  [key: string]: unknown;
}

export interface OrderbookLevel {
  price: string | number;
  size: string | number;
}

export interface Orderbook {
  symbol: string;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  timestamp?: number;
  [key: string]: unknown;
}

/**
 * GET /v1/markets — list all tradeable markets (perpetuals, e.g. BTC-PERP).
 */
export async function getProducts(): Promise<Product[]> {
  const res = await liquidFetch("/v1/markets", { method: "GET" });
  return parseResponse<Product[]>(res);
}

/** Alias for getProducts (tryliquid calls them "markets"). */
export async function getMarkets(): Promise<Product[]> {
  return getProducts();
}

/**
 * GET /v1/markets/:symbol/ticker — 24h ticker for a symbol.
 */
export async function getTicker(symbol: string): Promise<Ticker> {
  const path = `/v1/markets/${encodeURIComponent(symbol)}/ticker`;
  const res = await liquidFetch(path, { method: "GET" });
  return parseResponse<Ticker>(res);
}

/**
 * GET /v1/markets/:symbol/orderbook?depth=N — L2 order book.
 */
export async function getOrderbook(symbol: string, depth = 20): Promise<Orderbook> {
  const path = `/v1/markets/${encodeURIComponent(symbol)}/orderbook?depth=${depth}`;
  const res = await liquidFetch(path, { method: "GET" });
  return parseResponse<Orderbook>(res);
}

/**
 * GET /v1/markets/:symbol/candles — OHLCV candles (trade history by time).
 */
export interface Candle {
  timestamp: number;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
}

export async function getTrades(
  symbol: string,
  interval = "1h",
  limit = 100
): Promise<Candle[]> {
  const path = `/v1/markets/${encodeURIComponent(symbol)}/candles?interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const res = await liquidFetch(path, { method: "GET" });
  return parseResponse<Candle[]>(res);
}
