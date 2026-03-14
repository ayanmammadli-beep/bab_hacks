import axios from "axios";
import { config } from "../config";

const gamma = axios.create({
  baseURL: config.polymarket.gammaHost,
  timeout: 15_000,
  headers: { "Accept": "application/json" },
});

export interface MarketOutcome {
  token_id: string;
  outcome: string;
  price?: number;
}

export interface GammaMarket {
  id?: string;
  condition_id: string;
  question: string;
  slug?: string;
  tokens?: MarketOutcome[];
  outcomePrices?: string;
  active?: boolean;
  closed?: boolean;
  end_date_iso?: string;
  volume?: number;
  liquidity?: number;
  [key: string]: unknown;
}

export interface SimplifiedMarket {
  condition_id: string;
  question: string;
  slug?: string;
  tokens: MarketOutcome[];
  active?: boolean;
  closed?: boolean;
  end_date_iso?: string;
  volume?: number;
  liquidity?: number;
}

function parseMarkets(data: unknown): GammaMarket[] {
  if (Array.isArray(data)) return data as GammaMarket[];
  if (data && typeof data === "object" && "data" in (data as Record<string, unknown>)) {
    return ((data as Record<string, unknown>).data as GammaMarket[]) ?? [];
  }
  return [];
}

/**
 * List active markets. Optionally filter by search query.
 */
export async function getMarkets(search?: string): Promise<GammaMarket[]> {
  if (search && search.trim()) {
    const { data } = await gamma.get("/public-search", {
      params: { q: search.trim(), limit_per_type: 20 },
    });
    const events = (data?.events ?? []) as Array<{ markets?: GammaMarket[] }>;
    const markets: GammaMarket[] = [];
    for (const ev of events) {
      if (ev.markets) markets.push(...ev.markets);
    }
    return markets;
  }

  const { data } = await gamma.get("/markets", {
    params: { active: true, closed: false, limit: 100 },
  });
  return parseMarkets(data);
}

/**
 * Get a single market by condition_id or slug.
 */
export async function getMarketById(marketId: string): Promise<GammaMarket | null> {
  try {
    const { data } = await gamma.get("/markets", {
      params: { slug: marketId },
    });
    const list = parseMarkets(data);
    if (list.length > 0) return list[0];

    const byCondition = await gamma.get("/markets", {
      params: { condition_id: marketId },
    });
    const byList = parseMarkets(byCondition.data);
    return byList[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Get token ID for YES/NO side from market. Polymarket tokens array has outcome "Yes" / "No".
 */
export function getTokenIdForSide(market: GammaMarket, side: "YES" | "NO"): string | null {
  const outcome = side === "YES" ? "Yes" : "No";
  const token = market.tokens?.find(
    (t) => t.outcome?.toLowerCase() === outcome.toLowerCase()
  );
  return token?.token_id ?? null;
}

/**
 * Find a specific outcome in the market by its token id.
 */
export function getOutcomeByTokenId(market: GammaMarket, tokenId: string): MarketOutcome | null {
  return market.tokens?.find((t) => t.token_id === tokenId) ?? null;
}

/**
 * Get tick size and neg_risk from market for order building.
 */
export function getMarketOrderParams(market: GammaMarket): { tickSize: "0.1" | "0.01" | "0.001" | "0.0001"; negRisk: boolean } {
  const negRisk = Boolean((market as Record<string, unknown>).neg_risk ?? market.neg_risk);
  const raw = (market as Record<string, unknown>).tick_size ?? market.tick_size ?? "0.01";
  const tickSize = ["0.1", "0.01", "0.001", "0.0001"].includes(String(raw))
    ? (String(raw) as "0.1" | "0.01" | "0.001" | "0.0001")
    : "0.01";
  return { tickSize, negRisk };
}

/**
 * Get current price for a market side from market data.
 */
export function getCurrentPriceFromMarket(market: GammaMarket, side: "YES" | "NO"): number {
  const token = market.tokens?.find(
    (t) => t.outcome?.toLowerCase() === (side === "YES" ? "yes" : "no")
  );
  if (token?.price != null) return Number(token.price);
  const op = market.outcomePrices;
  if (typeof op === "string") {
    const parts = op.split(",").map((p) => parseFloat(p.trim()));
    if (side === "YES" && parts[0] != null) return parts[0];
    if (side === "NO" && parts[1] != null) return parts[1];
  }
  return 0.5;
}

/**
 * Get current price for a specific outcome token from market data.
 */
export function getCurrentPriceForToken(market: GammaMarket, tokenId: string): number {
  const outcome = getOutcomeByTokenId(market, tokenId);
  if (outcome?.price != null) return Number(outcome.price);
  // Fallback: if outcomePrices string exists and this is a binary market,
  // try to map using the binary helper when possible.
  if (market.tokens && market.tokens.length === 2) {
    const [a, b] = market.tokens;
    if (a.token_id === tokenId) {
      return getCurrentPriceFromMarket(market, "YES");
    }
    if (b.token_id === tokenId) {
      return getCurrentPriceFromMarket(market, "NO");
    }
  }
  return 0.5;
}
