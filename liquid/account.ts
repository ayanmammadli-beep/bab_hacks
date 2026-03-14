import { liquidFetch, parseResponse } from "./client.js";

export interface Account {
  equity: string | number;
  margin_used?: string | number;
  available_balance: string | number;
  account_value?: string | number;
  [key: string]: unknown;
}

export interface Balance {
  exchange?: string | number;
  equity: string | number;
  available_balance: string | number;
  margin_used?: string | number;
  cross_margin?: boolean;
  [key: string]: unknown;
}

/**
 * GET /v1/account — account overview.
 */
export async function getAccount(): Promise<Account> {
  const res = await liquidFetch("/v1/account", { method: "GET" });
  return parseResponse<Account>(res);
}

/**
 * GET /v1/account/balances — balance breakdown.
 */
export async function getBalances(): Promise<Balance> {
  const res = await liquidFetch("/v1/account/balances", { method: "GET" });
  return parseResponse<Balance>(res);
}
