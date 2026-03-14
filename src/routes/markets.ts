import { Router, Request, Response } from "express";
import { getMarkets, getMarketById } from "../services/polymarketService.js";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const markets = await getMarkets(search);
    res.json(markets);
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to fetch markets",
    });
  }
});

router.get("/:marketId", async (req: Request, res: Response) => {
  try {
    const { marketId } = req.params;
    const market = await getMarketById(marketId);
    if (!market) {
      res.status(404).json({ error: "Market not found" });
      return;
    }
    res.json(market);
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to fetch market",
    });
  }
});

export default router;
