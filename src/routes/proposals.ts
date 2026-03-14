import { Router, Request, Response } from "express";
import {
  createProposal,
  listProposals,
  voteOnProposal,
  executeProposal,
} from "../services/tradeService";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  try {
    const { groupChatId, marketId, side, amount, proposer, outcomeTokenId, outcomeLabel } = req.body;

    const hasBinarySide = side === "YES" || side === "NO";
    const hasOutcomeToken = typeof outcomeTokenId === "string" && outcomeTokenId.length > 0;

    if (!groupChatId || !marketId || (!hasBinarySide && !hasOutcomeToken) || amount == null || !proposer) {
      res.status(400).json({
        error:
          "Missing required fields: groupChatId, marketId, (side OR outcomeTokenId), amount, proposer",
      });
      return;
    }

    if (side && !hasBinarySide) {
      res.status(400).json({ error: "side must be YES or NO when provided" });
      return;
    }

    const result = await createProposal({
      groupChatId,
      marketId,
      side: hasBinarySide ? side : undefined,
      outcomeTokenId: hasOutcomeToken ? outcomeTokenId : undefined,
      outcomeLabel,
      amount: Number(amount),
      proposer,
    });
    res.status(201).json(result);
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to create proposal",
    });
  }
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const groupChatId = typeof req.query.groupChatId === "string" ? req.query.groupChatId : undefined;
    if (!groupChatId) {
      res.status(400).json({ error: "Query groupChatId is required" });
      return;
    }
    const list = await listProposals(groupChatId);
    res.json(list);
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to list proposals",
    });
  }
});

router.post("/:id/vote", async (req: Request, res: Response) => {
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
    const result = await voteOnProposal(id, {
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

router.post("/:id/execute", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await executeProposal(id);
    if (result.status === "executed") {
      res.json({
        status: "executed",
        txHash: result.txHash,
        positionId: result.positionId,
      });
      return;
    }
    if (result.status === "insufficient_approval") {
      res.status(400).json({
        status: "insufficient_approval",
        error: "Approval weight below threshold (default 0.6)",
      });
      return;
    }
    if (result.status === "expired" || result.status === "rejected") {
      res.status(400).json({ status: result.status });
      return;
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to execute proposal",
    });
  }
});

export default router;
