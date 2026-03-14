import "dotenv/config";
import path from "path";
import express from "express";
import cors from "cors";
import groupRoutes from "./routes/groups";
import proposalRoutes from "./routes/proposals";
import settlementRoutes from "./routes/settlement";
import liquidRoutes from "./routes/liquid";
import walletRoutes from "./routes/wallets";
import { getClient, getMasterWallet, getAccountBalance } from "./services/xrpl";
import { isLiquidConfigured } from "./services/liquid";

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend
app.use(express.static(path.join(__dirname, "../public")));

// XRPL group fund routes
app.use("/groups", groupRoutes);
app.use("/proposals", proposalRoutes);
app.use("/settlement", settlementRoutes);

// Liquid trading routes
app.use("/api", liquidRoutes);

// Wallet onboarding
app.use("/wallets", walletRoutes);

// Health check
app.get("/health", async (_req, res) => {
  let xrplStatus: any = { connected: false };
  try {
    const client = await getClient();
    const wallet = getMasterWallet();
    const balance = await getAccountBalance(wallet.address);
    xrplStatus = {
      connected: client.isConnected(),
      network: process.env.XRPL_NETWORK || "testnet",
      masterAddress: wallet.address,
      masterBalance: balance,
    };
  } catch {}

  res.json({
    status: "ok",
    xrpl: xrplStatus,
    liquid: { configured: isLiquidConfigured() },
  });
});

const PORT = parseInt(process.env.PORT || "3000", 10);

app.listen(PORT, async () => {
  console.log(`STRAITS API running on http://localhost:${PORT}`);

  try {
    const client = await getClient();
    const wallet = getMasterWallet();
    console.log(`XRPL connected: ${client.isConnected()}`);
    console.log(`Master wallet: ${wallet.address}`);
    const balance = await getAccountBalance(wallet.address);
    console.log(`Master balance: ${balance} XRP`);
  } catch (err: any) {
    console.warn(`XRPL not connected: ${err.message}`);
    console.warn("On-chain operations will fail until XRPL is reachable.\n");
  }

  console.log(`Liquid: ${isLiquidConfigured() ? "configured" : "not configured (set LIQUID_API_KEY + LIQUID_API_SECRET)"}`);

  console.log("\nGroup fund endpoints:");
  console.log("  POST /groups              GET  /groups");
  console.log("  GET  /groups/:id          POST /groups/:id/members");
  console.log("  POST /groups/:id/deposit  POST /groups/:id/withdraw");
  console.log("  GET  /groups/:id/balances GET  /groups/:id/voting-weights");
  console.log("  GET  /groups/:id/vault    (SAV on-chain state)");
  console.log("\nProposal endpoints:");
  console.log("  POST /proposals           GET  /proposals?groupId=xxx");
  console.log("  GET  /proposals/:id       POST /proposals/:id/vote");
  console.log("\nSettlement endpoints:");
  console.log("  POST /settlement/settle   POST /settlement/batch");
  console.log("  POST /settlement/escrow/:id/finish");
  console.log("  POST /settlement/escrow/:id/cancel");
  console.log("\nWallet onboarding endpoints:");
  console.log("  POST /wallets/create     GET  /wallets/:address");
  console.log("  POST /wallets/verify");
  console.log("\nLiquid trading endpoints:");
  console.log("  GET  /api/markets         GET  /api/balance");
  console.log("  GET  /api/orders          POST /api/orders");
  console.log("  GET  /api/orders/:id      POST /api/orders/:id/cancel");
  console.log("  GET  /api/ticker/:symbol");
});
