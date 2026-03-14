import { Router, Request, Response } from "express";
import { fundWalletFromFaucet, getAccountBalance, getClient, dropsToXrp } from "../services/xrpl";

const router = Router();

/**
 * POST /wallets/create
 * Creates a new XRPL wallet funded from the testnet faucet.
 * Returns address + seed. The caller (iMessage bot) must store the seed securely
 * and associate it with the user — it cannot be recovered later.
 */
router.post("/create", async (_req: Request, res: Response) => {
  try {
    const wallet = await fundWalletFromFaucet();
    res.status(201).json({
      address: wallet.address,
      seed: wallet.seed,
      publicKey: wallet.publicKey,
      warning: "Store this seed securely — it cannot be recovered if lost.",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /wallets/:address
 * Returns the XRP balance of any address.
 * Returns "0" for unfunded/non-existent accounts without erroring.
 */
router.get("/:address", async (req: Request, res: Response) => {
  try {
    const address = Array.isArray(req.params.address) ? req.params.address[0] : req.params.address;
    const balance = await getAccountBalance(address);
    res.json({
      address,
      balance,
      network: process.env.XRPL_NETWORK || "testnet",
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /wallets/verify
 * Verifies an existing XRPL address is active on-chain.
 * Use this during member onboarding to confirm a user-provided address is valid.
 */
router.post("/verify", async (req: Request, res: Response) => {
  try {
    const { address } = req.body;
    if (!address) {
      res.status(400).json({ error: "address is required" });
      return;
    }

    const c = await getClient();
    try {
      const response = await c.request({
        command: "account_info",
        account: address,
        ledger_index: "validated",
      });
      const balance = String(dropsToXrp((response.result.account_data as any).Balance));
      res.json({ valid: true, address, balance });
    } catch {
      // Account not found on ledger
      res.json({ valid: false, address, balance: "0" });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
