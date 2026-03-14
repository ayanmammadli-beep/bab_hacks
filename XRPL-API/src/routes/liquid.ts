import { Router, Request, Response } from "express";
import {
  liquidGetMarkets,
  liquidGetBalances,
  liquidGetOpenOrders,
  liquidPlaceOrder,
  liquidCancelOrder,
  liquidGetTicker,
  liquidGetOrder,
  isLiquidConfigured,
} from "../services/liquid";

const router = Router();

function paramStr(val: string | string[]): string {
  return Array.isArray(val) ? val[0] : val;
}

router.use((_req: Request, res: Response, next) => {
  if (!isLiquidConfigured()) {
    res.status(503).json({ ok: false, error: "Liquid API keys not configured" });
    return;
  }
  next();
});

router.get("/markets", async (_req: Request, res: Response) => {
  try {
    const markets = await liquidGetMarkets();
    res.json({ ok: true, data: markets });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/balance", async (_req: Request, res: Response) => {
  try {
    const balance = await liquidGetBalances();
    res.json({ ok: true, data: balance });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/orders", async (_req: Request, res: Response) => {
  try {
    const orders = await liquidGetOpenOrders();
    res.json({ ok: true, data: orders });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/orders/:id", async (req: Request, res: Response) => {
  try {
    const order = await liquidGetOrder(paramStr(req.params.id));
    res.json({ ok: true, data: order });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/orders", async (req: Request, res: Response) => {
  try {
    const { symbol = "BTC-PERP", side = "buy", quantity = 10, price, orderType = "market" } = req.body ?? {};
    const order = await liquidPlaceOrder({
      symbol: String(symbol),
      side: side === "sell" ? "sell" : "buy",
      orderType: orderType as "market" | "limit",
      quantity: Number(quantity) || 10,
      price: price != null ? Number(price) : undefined,
    });
    res.json({ ok: true, data: order });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/orders/:id/cancel", async (req: Request, res: Response) => {
  try {
    await liquidCancelOrder(paramStr(req.params.id));
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/ticker/:symbol", async (req: Request, res: Response) => {
  try {
    const ticker = await liquidGetTicker(paramStr(req.params.symbol));
    res.json({ ok: true, data: ticker });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
