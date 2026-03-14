import { Router, Request, Response } from "express";
import { store } from "../store";
import { createProposal, castVote, tallyVotes, expireStaleProposals } from "../services/voting";
import { createEscrow } from "../services/escrow";
import { getVotingWeights } from "../services/vault";
import { liquidPlaceOrder, liquidGetTicker, isLiquidConfigured } from "../services/liquid";

const router = Router();

function paramStr(val: string | string[]): string {
  return Array.isArray(val) ? val[0] : val;
}

// POST /proposals — Create a trade proposal
router.post("/", (req: Request, res: Response) => {
  try {
    const { groupId, proposerId, type, description, market, side, amount, quantity } = req.body;
    if (!groupId || !proposerId || !type || !market || !side || !amount) {
      res.status(400).json({
        error: "groupId, proposerId, type, market, side, and amount are required",
      });
      return;
    }

    const proposal = createProposal({
      groupId,
      proposerId,
      type,
      description: description || `${side} ${market}`,
      market,
      side,
      amount: parseFloat(amount),
      quantity: quantity != null ? parseFloat(quantity) : undefined,
    });

    const weights = getVotingWeights(groupId);

    res.status(201).json({
      proposal: {
        id: proposal.id,
        type: proposal.type,
        description: proposal.description,
        market: proposal.market,
        side: proposal.side,
        amount: proposal.amount,
        quantity: proposal.quantity,
        status: proposal.status,
        expiresAt: proposal.expiresAt,
      },
      votingWeights: weights,
      message: `Vote YES or NO. Voting closes at ${proposal.expiresAt}`,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /proposals/:id/vote — Cast a vote
router.post("/:id/vote", async (req: Request, res: Response) => {
  try {
    const { memberId, vote } = req.body;
    if (!memberId || !vote) {
      res.status(400).json({ error: "memberId and vote (yes/no) are required" });
      return;
    }
    if (vote !== "yes" && vote !== "no") {
      res.status(400).json({ error: "vote must be 'yes' or 'no'" });
      return;
    }

    const result = castVote(paramStr(req.params.id), memberId, vote);

    if (result.quorumReached) {
      const proposal = result.proposal;

      // 1. Lock funds on XRPL
      let escrow;
      try {
        escrow = await createEscrow({
          groupId: proposal.groupId,
          proposalId: proposal.id,
          amountXRP: proposal.amount.toFixed(6),
        });
      } catch (escrowErr: any) {
        // Revert proposal back to open so the group isn't deadlocked
        proposal.status = "open";
        store.saveProposal(proposal);
        throw escrowErr;
      }

      // 2. Execute trade on Liquid (if configured)
      let liquidOrder: any = null;
      if (isLiquidConfigured() && proposal.type === "crypto") {
        try {
          const side = (proposal.side === "long" || proposal.side === "yes") ? "buy" : "sell";
          const symbol = `${proposal.market}-PERP`;
          const ticker = await liquidGetTicker(symbol);
          const entryPrice = Number(ticker.mark_price);

          liquidOrder = await liquidPlaceOrder({
            symbol,
            side,
            orderType: "market",
            quantity: proposal.quantity ?? proposal.amount,
          });

          proposal.liquidOrderId = liquidOrder.order_id ?? undefined;
          proposal.liquidSymbol = symbol;
          proposal.liquidEntryPrice = entryPrice;
          store.saveProposal(proposal);
        } catch (err: any) {
          console.warn(`Liquid order failed (escrow still active): ${err.message}`);
        }
      }

      res.json({
        status: "approved_and_executed",
        yesWeight: result.yesWeight,
        noWeight: result.noWeight,
        proposal: {
          id: proposal.id,
          status: proposal.status,
          market: proposal.market,
          side: proposal.side,
          amount: proposal.amount,
        },
        escrow: {
          id: escrow.id,
          sequence: escrow.sequence,
          amount: escrow.amount,
          status: escrow.status,
        },
        liquidOrder: liquidOrder
          ? { orderId: liquidOrder.order_id, symbol: liquidOrder.symbol, status: liquidOrder.status }
          : null,
        message: liquidOrder
          ? `Trade approved! Escrow locked ${proposal.amount} XRP on XRPL. Liquid order placed: ${liquidOrder.order_id}`
          : `Trade approved! Escrow created for ${proposal.amount} XRP. Funds locked on XRPL.`,
      });
      return;
    }

    res.json({
      status: result.proposal.status,
      yesWeight: result.yesWeight,
      noWeight: result.noWeight,
      votes: result.proposal.votes.map((v) => ({
        handle: v.memberHandle,
        vote: v.vote,
        weight: v.weight,
      })),
      message:
        result.proposal.status === "rejected"
          ? "Proposal rejected — NO votes exceed blocking threshold."
          : `Vote recorded. YES: ${(result.yesWeight * 100).toFixed(1)}%, NO: ${(result.noWeight * 100).toFixed(1)}%`,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /proposals/:id — Get proposal details
router.get("/:id", (req: Request, res: Response) => {
  const proposal = store.getProposal(paramStr(req.params.id));
  if (!proposal) {
    res.status(404).json({ error: "Proposal not found" });
    return;
  }

  const tally = tallyVotes(proposal);

  res.json({
    ...proposal,
    tally: {
      yesWeight: tally.yesWeight,
      noWeight: tally.noWeight,
      totalVoted: tally.totalVoted,
    },
  });
});

// GET /proposals?groupId=xxx — List proposals for a group
router.get("/", (req: Request, res: Response) => {
  const groupId = req.query.groupId as string;
  if (!groupId) {
    res.status(400).json({ error: "groupId query param is required" });
    return;
  }
  const proposals = store.getProposalsByGroup(groupId).map((p) => ({
    id: p.id,
    type: p.type,
    market: p.market,
    side: p.side,
    amount: p.amount,
    status: p.status,
    voteCount: p.votes.length,
    createdAt: p.createdAt,
  }));
  res.json(proposals);
});

// POST /proposals/expire — Manually expire stale proposals
router.post("/expire", (_req: Request, res: Response) => {
  const count = expireStaleProposals();
  res.json({ expired: count });
});

export default router;
