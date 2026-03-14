import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import {
  getProducts,
  getBalances,
  placeOrder,
  getOpenOrders,
  cancelOrder,
} from "../liquid/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

app.get("/api/markets", async (_req, res) => {
  try {
    const markets = await getProducts();
    res.json({ ok: true, data: markets });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e as Error).message) });
  }
});

app.get("/api/balance", async (_req, res) => {
  try {
    const balance = await getBalances();
    res.json({ ok: true, data: balance });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e as Error).message) });
  }
});

app.get("/api/orders", async (_req, res) => {
  try {
    const orders = await getOpenOrders();
    res.json({ ok: true, data: orders });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e as Error).message) });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const { symbol = "BTC-PERP", side = "buy", quantity = 10, price = 10000 } = req.body ?? {};
    const order = await placeOrder({
      symbol: String(symbol),
      side: side === "sell" ? "sell" : "buy",
      orderType: "limit",
      quantity: Number(quantity) || 10,
      price: Number(price) || 10000,
    });
    res.json({ ok: true, data: order });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e as Error).message) });
  }
});

app.post("/api/orders/:id/cancel", async (req, res) => {
  try {
    await cancelOrder(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e as Error).message) });
  }
});

app.listen(PORT, () => {
  console.log(`Liquid demo: http://localhost:${PORT}`);
});
