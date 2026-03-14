import crypto from "crypto";

const BASE_URL =
  process.env.LIQUID_BASE_URL ||
  "https://prometheus-prod--liquid-public-api-public-fastapi-app.modal.run";

function getEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing env: ${name}`);
  return val;
}

function canonicalizePath(path: string): string {
  return (path.replace(/\?.*$/, "").replace(/\/+$/, "").toLowerCase()) || "/";
}

function canonicalizeQuery(qs: string): string {
  if (!qs) return "";
  const params = new URLSearchParams(qs);
  const sorted = [...params.entries()].sort((a, b) =>
    a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])
  );
  return sorted.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

function computeBodyHash(body: string | null): string {
  if (!body || body.length === 0)
    return crypto.createHash("sha256").update("").digest("hex");
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const canonical = JSON.stringify(parsed, Object.keys(parsed).sort());
    return crypto.createHash("sha256").update(canonical).digest("hex");
  } catch {
    return crypto.createHash("sha256").update(body).digest("hex");
  }
}

function sign(
  secret: string,
  method: string,
  path: string,
  qs: string,
  body: string | null
) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(16).toString("hex");
  const message = `${timestamp}\n${nonce}\n${method.toUpperCase()}\n${canonicalizePath(path)}\n${canonicalizeQuery(qs)}\n${computeBodyHash(body)}`;
  const signature = crypto.createHmac("sha256", secret).update(message).digest("hex");
  return { timestamp, nonce, signature };
}

async function liquidFetch<T = unknown>(
  path: string,
  opts: { method?: string; body?: string; skipAuth?: boolean } = {}
): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const method = (opts.method || "GET").toUpperCase();
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (!opts.skipAuth) {
    const apiKey = getEnv("LIQUID_API_KEY");
    const apiSecret = getEnv("LIQUID_API_SECRET");
    const [pathPart, queryPart] = path.split("?");
    const s = sign(apiSecret, method, pathPart ?? path, queryPart ?? "", opts.body ?? null);
    headers["X-Liquid-Key"] = apiKey;
    headers["X-Liquid-Timestamp"] = s.timestamp;
    headers["X-Liquid-Nonce"] = s.nonce;
    headers["X-Liquid-Signature"] = s.signature;
  }

  const res = await fetch(url, { method, headers, body: opts.body });
  const text = await res.text();
  if (!res.ok) throw new Error(`Liquid ${res.status}: ${text}`);
  if (!text) return undefined as T;
  const data = JSON.parse(text) as any;
  if (data && typeof data.success === "boolean") {
    if (data.success) return data.data as T;
    throw new Error(`Liquid: ${data.error?.code ?? "UNKNOWN"}: ${data.error?.message ?? text}`);
  }
  return data as T;
}

// --- Public API ---

export interface LiquidOrder {
  order_id: string | null;
  symbol: string;
  side: string;
  type: string;
  size: number;
  price?: number | null;
  status: string;
  [key: string]: unknown;
}

export interface LiquidTicker {
  mark_price: string | number;
  volume_24h?: string | number;
  change_24h?: string | number;
  [key: string]: unknown;
}

export async function liquidPlaceOrder(params: {
  symbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  quantity: number;
  price?: number;
}): Promise<LiquidOrder> {
  const body: Record<string, unknown> = {
    symbol: params.symbol,
    side: params.side,
    type: params.orderType,
    size: params.quantity,
    leverage: 1,
    time_in_force: "gtc",
    reduce_only: false,
  };
  if (params.price != null) body.price = params.price;
  return liquidFetch<LiquidOrder>("/v1/orders", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function liquidGetOrder(orderId: string): Promise<LiquidOrder> {
  return liquidFetch<LiquidOrder>(`/v1/orders/${encodeURIComponent(orderId)}`);
}

export async function liquidGetOpenOrders(): Promise<LiquidOrder[]> {
  return liquidFetch<LiquidOrder[]>("/v1/orders");
}

export async function liquidCancelOrder(orderId: string): Promise<void> {
  await liquidFetch(`/v1/orders/${encodeURIComponent(orderId)}`, { method: "DELETE" });
}

export async function liquidGetTicker(symbol: string): Promise<LiquidTicker> {
  return liquidFetch<LiquidTicker>(`/v1/markets/${encodeURIComponent(symbol)}/ticker`);
}

export async function liquidGetMarkets(): Promise<any[]> {
  return liquidFetch<any[]>("/v1/markets");
}

export async function liquidGetBalances(): Promise<any> {
  return liquidFetch<any>("/v1/account/balances");
}

export function isLiquidConfigured(): boolean {
  return !!(process.env.LIQUID_API_KEY && process.env.LIQUID_API_SECRET);
}
