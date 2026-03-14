import { Router, Request, Response } from "express";
import { store } from "../store";
import {
  createGroup,
  addMember,
  recordDeposit,
  recordWithdrawal,
  getGroupBalance,
  getVotingWeights,
} from "../services/vault";
import { sendXRP, Wallet } from "../services/xrpl";

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

// POST /groups/:id/members — Add a member
router.post("/:id/members", (req: Request, res: Response) => {
  try {
    const { handle, xrplAddress } = req.body;
    if (!handle || !xrplAddress) {
      res.status(400).json({ error: "handle and xrplAddress are required" });
      return;
    }
    const member = addMember(paramStr(req.params.id), handle, xrplAddress);
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

    const member = recordDeposit(gid, memberId, parseFloat(amount));
    const balance = await getGroupBalance(gid);

    res.json({
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

    const vaultWallet = Wallet.fromSeed(group.vaultWalletSeed);
    const txHash = await sendXRP(
      vaultWallet,
      memberBefore.xrplAddress,
      parseFloat(amount).toFixed(6)
    );

    const member = recordWithdrawal(gid, memberId, parseFloat(amount));
    const balance = await getGroupBalance(gid);

    res.json({
      txHash,
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

export default router;
