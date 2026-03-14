import { Router } from "express";
import { getOrCreateWallet, getWalletInfo, fundWallet } from "../services/walletService.js";

const router = Router();

/**
 * GET /wallets/:groupChatId
 * Returns the Polygon wallet address and current USDC balance for a group.
 * The address is where USDC should be sent to fund the group's trading capital.
 */
router.get("/:groupChatId", async (req, res) => {
  try {
    const info = await getWalletInfo(req.params.groupChatId);
    if (!info) {
      res.status(404).json({ error: "Wallet not found. Create a proposal first to auto-create a wallet." });
      return;
    }
    res.json({
      groupChatId: req.params.groupChatId,
      polygonAddress: info.address,
      usdcBalance: info.usdcBalance,
      note: "Send USDC (Polygon) to polygonAddress, then call POST /wallets/:groupChatId/fund to record the deposit.",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /wallets/:groupChatId/fund
 * Body: { amount: number }
 * Records that USDC has been deposited to this group's Polygon wallet.
 * This is the manual funding step — admin sends USDC on-chain then calls this
 * endpoint to credit the tracked balance so proposals can execute.
 */
router.post("/:groupChatId/fund", async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    if (!amount || amount <= 0) {
      res.status(400).json({ error: "amount must be a positive number" });
      return;
    }
    const result = await fundWallet(req.params.groupChatId, amount);
    res.json({
      groupChatId: req.params.groupChatId,
      funded: amount,
      usdcBalance: result.usdcBalance,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /wallets/:groupChatId
 * Ensures a Polygon wallet exists for this group (idempotent).
 */
router.post("/:groupChatId", async (req, res) => {
  try {
    const wallet = await getOrCreateWallet(req.params.groupChatId);
    res.json({
      groupChatId: wallet.groupChatId,
      polygonAddress: wallet.address,
      usdcBalance: wallet.usdcBalance,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
