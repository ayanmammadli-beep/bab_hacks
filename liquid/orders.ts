import { liquidFetch, parseResponse } from "./client.js";

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit";

export interface PlaceOrderParams {
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  /** Size in USD notional */
  quantity: number;
  price?: number;
  leverage?: number;
  tp?: number;
  sl?: number;
  reduceOnly?: boolean;
  timeInForce?: "gtc" | "ioc";
}

export interface Order {
  order_id: string | null;
  symbol: string;
  side: string;
  type: string;
  size: number;
  price?: number | null;
  leverage?: number;
  status: string;
  exchange?: string;
  tp?: number | null;
  sl?: number | null;
  reduce_only?: boolean;
  created_at?: string | null;
  [key: string]: unknown;
}

export interface PlaceOrderResponse {
  order_id: string | null;
  symbol: string;
  side: string;
  type: string;
  size: number;
  price?: number | null;
  status: string;
  [key: string]: unknown;
}

/**
 * POST /v1/orders — place order. Size is USD notional; price required for limit.
 */
export async function placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResponse> {
  const {
    symbol,
    side,
    orderType,
    quantity,
    price,
    leverage = 1,
    tp,
    sl,
    reduceOnly = false,
    timeInForce = "gtc",
  } = params;
  const body: Record<string, unknown> = {
    symbol,
    side,
    type: orderType,
    size: quantity,
    leverage,
    time_in_force: timeInForce,
    reduce_only: reduceOnly,
  };
  if (price != null) body.price = price;
  if (tp != null) body.tp = tp;
  if (sl != null) body.sl = sl;
  const res = await liquidFetch("/v1/orders", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return parseResponse<PlaceOrderResponse>(res);
}

/**
 * DELETE /v1/orders/:id — cancel order.
 */
export async function cancelOrder(orderId: string): Promise<void> {
  const path = `/v1/orders/${encodeURIComponent(orderId)}`;
  const res = await liquidFetch(path, { method: "DELETE" });
  await parseResponse(res);
}

/**
 * GET /v1/orders — list open orders.
 */
export async function getOpenOrders(): Promise<Order[]> {
  const res = await liquidFetch("/v1/orders", { method: "GET" });
  return parseResponse<Order[]>(res);
}

/**
 * GET /v1/orders/:id — get single order by id.
 */
export async function getOrder(orderId: string): Promise<Order> {
  const path = `/v1/orders/${encodeURIComponent(orderId)}`;
  const res = await liquidFetch(path, { method: "GET" });
  return parseResponse<Order>(res);
}

/**
 * GET /v1/orders — returns same as getOpenOrders (API may support status filter later).
 */
export async function getOrderHistory(): Promise<Order[]> {
  const res = await liquidFetch("/v1/orders", { method: "GET" });
  return parseResponse<Order[]>(res);
}
