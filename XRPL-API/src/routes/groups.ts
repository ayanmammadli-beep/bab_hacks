import { Router, Request, Response } from "express";
import { store } from "../store";
import {
  createGroup,
  addMember,
  recordDeposit,
  recordWithdrawal,
  getGroupBalance,
  getVotingWeights,
  getGroupVaultInfo,
  detectDeposits,
} from "../services/vault";
import { sendXRP, Wallet, getAccountBalance } from "../services/xrpl";
import { tallyVotes } from "../services/voting";

const router = Router();

function paramStr(val: string | string[]): string {
  return Array.isArray(val) ? val[0] : val;
}

// POST /groups — Create a new fund group
router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, threshold } = req.body;
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const group = await createGroup(name, threshold);
    res.status(201).json({
      id: group.id,
      name: group.name,
      vaultAddress: group.vaultWalletAddress,
      threshold: group.threshold,
      sav: group.savVaultId ? {
        vaultId: group.savVaultId,
        vaultAccount: group.savVaultAccount,
        mptIssuanceId: group.mptIssuanceId,
        shareMPTId: group.savShareMPTId,
      } : null,
      createdAt: group.createdAt,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /groups — List all groups
router.get("/", (_req: Request, res: Response) => {
  const groups = store.getAllGroups().map((g) => ({
    id: g.id,
    name: g.name,
    vaultAddress: g.vaultWalletAddress,
    memberCount: g.members.length,
    threshold: g.threshold,
  }));
  res.json(groups);
});

// GET /groups/:id — Get group details
router.get("/:id", (req: Request, res: Response) => {
  const group = store.getGroup(paramStr(req.params.id));
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  res.json({
    id: group.id,
    name: group.name,
    vaultAddress: group.vaultWalletAddress,
    threshold: group.threshold,
    members: group.members.map((m) => ({
      id: m.id,
      handle: m.handle,
      xrplAddress: m.xrplAddress,
      depositedAmount: m.depositedAmount,
      destinationTag: m.destinationTag,
    })),
    createdAt: group.createdAt,
  });
});

// POST /groups/:id/members — Add a member (idempotent: returns existing member if handle already registered)
router.post("/:id/members", (req: Request, res: Response) => {
  try {
    const { handle, xrplAddress } = req.body;
    if (!handle || !xrplAddress) {
      res.status(400).json({ error: "handle and xrplAddress are required" });
      return;
    }
    const gid = paramStr(req.params.id);
    const group = store.getGroup(gid);
    if (group) {
      const existing = group.members.find((m) => m.handle === handle);
      if (existing) {
        res.json(existing);
        return;
      }
    }
    const member = addMember(gid, handle, xrplAddress);
    res.status(201).json(member);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /groups/:id/deposit — Record a deposit and optionally send XRP
router.post("/:id/deposit", async (req: Request, res: Response) => {
  try {
    const { memberId, amount } = req.body;
    if (!memberId || !amount) {
      res.status(400).json({ error: "memberId and amount are required" });
      return;
    }

    const gid = paramStr(req.params.id);
    const group = store.getGroup(gid);
    if (!group) {
      res.status(404).json({ error: "Group not found" });
      return;
    }

    const { member, savTxHash } = await recordDeposit(gid, memberId, parseFloat(amount));
    const balance = await getGroupBalance(gid);

    res.json({
      member: {
        id: member.id,
        handle: member.handle,
        depositedAmount: member.depositedAmount,
      },
      savDeposit: savTxHash ? { txHash: savTxHash } : null,
      groupBalance: balance,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /groups/:id/withdraw — Record a withdrawal and send XRP back
router.post("/:id/withdraw", async (req: Request, res: Response) => {
  try {
    const { memberId, amount } = req.body;
    if (!memberId || !amount) {
      res.status(400).json({ error: "memberId and amount are required" });
      return;
    }

    const gid = paramStr(req.params.id);
    const group = store.getGroup(gid);
    if (!group) {
      res.status(404).json({ error: "Group not found" });
      return;
    }

    const memberBefore = group.members.find((m) => m.id === memberId);
    if (!memberBefore) {
      res.status(404).json({ error: "Member not found" });
      return;
    }

    // Guard: ensure withdrawal doesn't exceed vault's available (unlocked) XRP
    const activeEscrows = store.getActiveEscrowsByGroup(gid);
    const lockedXRP = activeEscrows.reduce((sum, e) => sum + parseFloat(e.amount), 0);
    const vaultBalanceXRP = parseFloat(await getAccountBalance(group.vaultWalletAddress));
    const availableXRP = vaultBalanceXRP - lockedXRP;
    if (parseFloat(amount) > availableXRP) {
      res.status(400).json({
        error: `Insufficient available funds. Vault: ${vaultBalanceXRP} XRP, locked in escrow: ${lockedXRP} XRP, available: ${availableXRP.toFixed(6)} XRP`,
      });
      return;
    }

    const vaultWallet = Wallet.fromSeed(group.vaultWalletSeed);
    const txHash = await sendXRP(
      vaultWallet,
      memberBefore.xrplAddress,
      parseFloat(amount).toFixed(6)
    );

    const { member, savTxHash } = await recordWithdrawal(gid, memberId, parseFloat(amount));
    const balance = await getGroupBalance(gid);

    res.json({
      txHash,
      savWithdraw: savTxHash ? { txHash: savTxHash } : null,
      member: {
        id: member.id,
        handle: member.handle,
        depositedAmount: member.depositedAmount,
      },
      groupBalance: balance,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /groups/:id/balances — Get vault balances and member shares
router.get("/:id/balances", async (req: Request, res: Response) => {
  try {
    const balance = await getGroupBalance(paramStr(req.params.id));
    res.json(balance);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /groups/:id/voting-weights — Get current voting weights
router.get("/:id/voting-weights", (req: Request, res: Response) => {
  try {
    const weights = getVotingWeights(paramStr(req.params.id));
    res.json(weights);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /groups/:id/vault — Get on-chain SAV state (XLS-65)
router.get("/:id/vault", async (req: Request, res: Response) => {
  try {
    const info = await getGroupVaultInfo(paramStr(req.params.id));
    res.json(info);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /groups/:id/portfolio — Single-call summary for the iMessage bot
router.get("/:id/portfolio", async (req: Request, res: Response) => {
  try {
    const gid = paramStr(req.params.id);
    const group = store.getGroup(gid);
    if (!group) {
      res.status(404).json({ error: "Group not found" });
      return;
    }

    const balance = await getGroupBalance(gid);
    const activeEscrows = store.getActiveEscrowsByGroup(gid);
    const lockedXRP = activeEscrows.reduce((sum, e) => sum + parseFloat(e.amount), 0);
    const availableXRP = parseFloat(balance.xrpBalance) - lockedXRP;

    const allProposals = store.getProposalsByGroup(gid);
    const openProposals = allProposals.filter((p) => p.status === "open");
    const activePositions = allProposals.filter((p) => p.status === "executed");
    const recentSettled = allProposals
      .filter((p) => p.status === "settled")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 3);

    res.json({
      group: {
        id: group.id,
        name: group.name,
        vaultAddress: group.vaultWalletAddress,
        threshold: group.threshold,
        memberCount: group.members.length,
      },
      vault: {
        totalXRP: balance.xrpBalance,
        lockedXRP,
        availableXRP: availableXRP < 0 ? 0 : availableXRP,
      },
      memberShares: balance.members,
      openProposals: openProposals.map((p) => ({
        id: p.id,
        description: p.description,
        market: p.market,
        side: p.side,
        amount: p.amount,
        quantity: p.quantity,
        expiresAt: p.expiresAt,
        tally: tallyVotes(p),
      })),
      activePositions: activePositions.map((p) => ({
        id: p.id,
        description: p.description,
        market: p.market,
        side: p.side,
        amount: p.amount,
        quantity: p.quantity,
        liquidOrderId: p.liquidOrderId,
        liquidSymbol: p.liquidSymbol,
        liquidEntryPrice: p.liquidEntryPrice,
      })),
      recentSettled: recentSettled.map((p) => ({
        id: p.id,
        market: p.market,
        side: p.side,
        amount: p.amount,
        status: p.status,
        createdAt: p.createdAt,
      })),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /groups/:id/detect-deposits — Scan chain for incoming deposits by destination tag
router.post("/:id/detect-deposits", async (req: Request, res: Response) => {
  try {
    const result = await detectDeposits(paramStr(req.params.id));
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
