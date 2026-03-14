import { Router, Request, Response } from "express";
import { store } from "../store";
import { finishEscrow, cancelEscrow, batchFinishEscrows } from "../services/escrow";
import { settleProposal, batchSettle } from "../services/settlement";

const router = Router();

function paramStr(val: string | string[]): string {
  return Array.isArray(val) ? val[0] : val;
}

// POST /settlement/settle — Settle a single proposal
// If returnMultiplier is omitted and a Liquid position exists, P&L is computed automatically
router.post("/settle", async (req: Request, res: Response) => {
  try {
    const { proposalId, outcome, returnMultiplier } = req.body;
    if (!proposalId || !outcome) {
      res.status(400).json({
        error: "proposalId and outcome ('win' or 'loss') are required",
      });
      return;
    }

    const result = await settleProposal(
      proposalId,
      outcome,
      returnMultiplier != null ? parseFloat(returnMultiplier) : undefined
    );
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /settlement/batch — Batch settle multiple proposals
router.post("/batch", async (req: Request, res: Response) => {
  try {
    const { settlements } = req.body;
    if (!Array.isArray(settlements) || settlements.length === 0) {
      res.status(400).json({
        error: "settlements array is required with at least one entry",
      });
      return;
    }
    const results = await batchSettle(settlements);
    res.json({ results });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /settlement/escrow/:id/finish — Manually finish an escrow
router.post("/escrow/:id/finish", async (req: Request, res: Response) => {
  try {
    const result = await finishEscrow(paramStr(req.params.id));
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /settlement/escrow/:id/cancel — Cancel an escrow
router.post("/escrow/:id/cancel", async (req: Request, res: Response) => {
  try {
    const result = await cancelEscrow(paramStr(req.params.id));
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /settlement/escrows?groupId=xxx — List active escrows for a group
router.get("/escrows", (req: Request, res: Response) => {
  const groupId = req.query.groupId as string;
  if (!groupId) {
    res.status(400).json({ error: "groupId query param is required" });
    return;
  }
  const escrows = store.getActiveEscrowsByGroup(groupId);
  res.json(escrows);
});

export default router;
