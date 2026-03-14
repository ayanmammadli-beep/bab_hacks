import { Router, Request, Response } from "express";
import {
  createPredictionProposal,
  listPredictionProposals,
  voteOnPredictionProposal,
  executePredictionProposal,
  listPredictionMarkets,
  getPredictionMarket,
  placePredictionBet,
  voteOnResolution,
  getPredictionPayouts,
} from "../services/predictionMarketService.js";
import { PredictionMarketStatus } from "@prisma/client";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ ok: true, scope: "prediction-markets" });
});

// --- Proposals ---

router.post("/proposals", async (req: Request, res: Response) => {
  try {
    const { groupChatId, description, eventDeadline, initialLiquidityAmount, proposer } =
      req.body;
    if (
      !groupChatId ||
      !description ||
      !eventDeadline ||
      initialLiquidityAmount == null ||
      !proposer
    ) {
      res.status(400).json({
        error:
          "Missing required fields: groupChatId, description, eventDeadline, initialLiquidityAmount, proposer",
      });
      return;
    }
    const deadline = new Date(eventDeadline);
    if (isNaN(deadline.getTime())) {
      res.status(400).json({ error: "eventDeadline must be a valid ISO date" });
      return;
    }
    const amount = Number(initialLiquidityAmount);
    if (amount <= 0 || !Number.isFinite(amount)) {
      res.status(400).json({ error: "initialLiquidityAmount must be a positive number" });
      return;
    }
    const result = await createPredictionProposal({
      groupChatId,
      description,
      eventDeadline: deadline,
      initialLiquidityAmount: amount,
      proposer,
    });
    res.status(201).json(result);
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to create prediction market proposal",
    });
  }
});

router.get("/proposals", async (req: Request, res: Response) => {
  try {
    const groupChatId =
      typeof req.query.groupChatId === "string" ? req.query.groupChatId : undefined;
    if (!groupChatId) {
      res.status(400).json({ error: "Query groupChatId is required" });
      return;
    }
    const list = await listPredictionProposals(groupChatId);
    res.json(list);
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to list proposals",
    });
  }
});

router.post("/proposals/:id/vote", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, vote, weight } = req.body;
    if (!userId || !vote) {
      res.status(400).json({ error: "Missing required fields: userId, vote" });
      return;
    }
    if (vote !== "approve" && vote !== "reject") {
      res.status(400).json({ error: "vote must be approve or reject" });
      return;
    }
    const result = await voteOnPredictionProposal(id, {
      userId,
      vote,
      weight: weight != null ? Number(weight) : undefined,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to record vote",
    });
  }
});

router.post("/proposals/:id/execute", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await executePredictionProposal(id);
    if (result.status === "created") {
      res.status(201).json({
        status: "created",
        marketId: result.marketId,
      });
      return;
    }
    if (result.status === "already_created") {
      res.json({
        status: "already_created",
        marketId: result.marketId,
      });
      return;
    }
    if (result.status === "insufficient_approval") {
      res.status(400).json({
        status: "insufficient_approval",
        error: "Approval below threshold",
      });
      return;
    }
    res.status(400).json({ status: result.status });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to execute proposal",
    });
  }
});

// --- Markets ---

router.get("/markets", async (req: Request, res: Response) => {
  try {
    const groupChatId =
      typeof req.query.groupChatId === "string" ? req.query.groupChatId : undefined;
    if (!groupChatId) {
      res.status(400).json({ error: "Query groupChatId is required" });
      return;
    }
    const status =
      typeof req.query.status === "string" && req.query.status in PredictionMarketStatus
        ? (req.query.status as PredictionMarketStatus)
        : undefined;
    const list = await listPredictionMarkets(groupChatId, status);
    res.json(list);
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to list prediction markets",
    });
  }
});

router.get("/markets/:marketId", async (req: Request, res: Response) => {
  try {
    const { marketId } = req.params;
    const market = await getPredictionMarket(marketId);
    if (!market) {
      res.status(404).json({ error: "Prediction market not found" });
      return;
    }
    res.json(market);
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to get prediction market",
    });
  }
});

// --- Betting ---

router.post("/markets/:marketId/bets", async (req: Request, res: Response) => {
  try {
    const { marketId } = req.params;
    const { userId, amount, side } = req.body;
    if (!userId || amount == null || !side) {
      res.status(400).json({
        error: "Missing required fields: userId, amount, side",
      });
      return;
    }
    if (side !== "YES" && side !== "NO") {
      res.status(400).json({ error: "side must be YES or NO" });
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      res.status(400).json({ error: "amount must be a positive number" });
      return;
    }
    const result = await placePredictionBet({
      marketId,
      userId,
      amount: amt,
      side,
    });
    res.status(201).json(result);
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to place bet",
    });
  }
});

// --- Resolution ---

router.post("/markets/:marketId/resolution-votes", async (req: Request, res: Response) => {
  try {
    const { marketId } = req.params;
    const { userId, outcome } = req.body;
    if (!userId || !outcome) {
      res.status(400).json({
        error: "Missing required fields: userId, outcome",
      });
      return;
    }
    if (outcome !== "YES" && outcome !== "NO") {
      res.status(400).json({ error: "outcome must be YES or NO" });
      return;
    }
    const result = await voteOnResolution(marketId, {
      userId,
      outcome,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to record resolution vote",
    });
  }
});

// --- Payouts ---

router.get("/markets/:marketId/payouts", async (req: Request, res: Response) => {
  try {
    const { marketId } = req.params;
    const result = await getPredictionPayouts(marketId);
    res.json(result);
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to get payouts",
    });
  }
});

export default router;
