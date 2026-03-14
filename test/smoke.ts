import "dotenv/config";
import {
  getProducts,
  getBalances,
  placeOrder,
  getOpenOrders,
  cancelOrder,
} from "../liquid/index.js";

async function smoke() {
  console.log("1. getProducts() → find BTC-PERP");
  const products = await getProducts();
  const btcPerp = products.find(
    (p) =>
      p.symbol === "BTC-PERP" ||
      (p.symbol && String(p.symbol).toUpperCase().includes("BTC"))
  );
  if (!btcPerp) {
    console.log("Markets sample:", products.slice(0, 5).map((p) => p.symbol));
    throw new Error("BTC-PERP (or BTC) market not found");
  }
  const symbol = btcPerp.symbol;
  console.log("Symbol:", symbol);

  console.log("\n2. getBalances() → log balance");
  const balance = await getBalances();
  console.log(
    "Balance:",
    JSON.stringify(
      {
        equity: balance.equity,
        available_balance: balance.available_balance,
        margin_used: balance.margin_used,
      },
      null,
      2
    )
  );

  console.log("\n3. placeOrder() → limit buy $10 @ 10000 (below market, won't fill)");
  const order = await placeOrder({
    symbol,
    side: "buy",
    orderType: "limit",
    quantity: 10, // min order value $10
    price: 10000, // valid but far below market so it won't fill
  });
  const orderId = order.order_id ?? String((order as { id?: string }).id ?? "");
  if (!orderId) {
    throw new Error("No order_id in response: " + JSON.stringify(order));
  }
  console.log("Placed order id:", orderId);

  console.log("\n4. getOpenOrders() → confirm order appears");
  const open = await getOpenOrders();
  const found = open.find(
    (o) => o.order_id === orderId || String((o as { id?: string }).id) === orderId
  );
  if (!found) {
    throw new Error(
      `Open order ${orderId} not found. Open: ${JSON.stringify(open.map((o) => o.order_id ?? (o as { id?: string }).id))}`
    );
  }
  console.log("Order in open list:", found.order_id ?? found);

  console.log("\n5. cancelOrder() → cancel and confirm gone");
  await cancelOrder(orderId);
  const openAfter = await getOpenOrders();
  const stillThere = openAfter.some(
    (o) => o.order_id === orderId || String((o as { id?: string }).id) === orderId
  );
  if (stillThere) {
    throw new Error(`Order ${orderId} still in open orders after cancel`);
  }
  console.log("Order cancelled and no longer in open orders.");

  console.log("\nSmoke test passed.");
}

smoke().catch((e) => {
  console.error(e);
  process.exit(1);
});
