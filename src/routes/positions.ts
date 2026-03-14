import { Router, Request, Response } from "express";
import { listPositions, closePosition } from "../services/tradeService.js";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const groupChatId = typeof req.query.groupChatId === "string" ? req.query.groupChatId : undefined;
    if (!groupChatId) {
      res.status(400).json({ error: "Query groupChatId is required" });
      return;
    }
    const list = await listPositions(groupChatId);
    res.json(list);
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to list positions",
    });
  }
});

router.post("/:id/exit", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;
    if (!userId) {
      res.status(400).json({ error: "Missing required field: userId" });
      return;
    }
    const result = await closePosition(id, userId);
    res.json(result);
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to close position",
    });
  }
});

export default router;
