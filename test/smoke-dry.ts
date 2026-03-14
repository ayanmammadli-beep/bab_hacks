/**
 * Dry-run smoke: verify module loads and exports without calling the API.
 * Run `npm run smoke` for full live API test (requires .env + network).
 */
import * as liquid from "../liquid/index.js";

const required: (keyof typeof liquid)[] = [
  "getProducts",
  "getMarkets",
  "getTicker",
  "getOrderbook",
  "getTrades",
  "getBalances",
  "getAccount",
  "placeOrder",
  "cancelOrder",
  "getOpenOrders",
  "getOrder",
  "getOrderHistory",
  "liquidFetch",
  "parseResponse",
];

for (const name of required) {
  const fn = liquid[name];
  if (typeof fn !== "function") {
    throw new Error(`Expected liquid.${name} to be a function, got ${typeof fn}`);
  }
}

console.log("liquid module: all required exports present and callable.");
console.log(
  "Run `npm run smoke` with .env (LIQUID_API_KEY, LIQUID_API_SECRET) for full API smoke."
);
