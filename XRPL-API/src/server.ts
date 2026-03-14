import "dotenv/config";
import express from "express";
import cors from "cors";
import groupRoutes from "./routes/groups";
import proposalRoutes from "./routes/proposals";
import settlementRoutes from "./routes/settlement";
import { getClient, getMasterWallet, getAccountBalance } from "./services/xrpl";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/groups", groupRoutes);
app.use("/proposals", proposalRoutes);
app.use("/settlement", settlementRoutes);

// Health check + XRPL connection status
app.get("/health", async (_req, res) => {
  try {
    const client = await getClient();
    const wallet = getMasterWallet();
    const balance = await getAccountBalance(wallet.address);
    res.json({
      status: "ok",
      xrpl: {
        connected: client.isConnected(),
        network: process.env.XRPL_NETWORK || "testnet",
        masterAddress: wallet.address,
        masterBalance: balance,
      },
    });
  } catch (err: any) {
    res.status(500).json({ status: "error", error: err.message });
  }
});

const PORT = parseInt(process.env.PORT || "3000", 10);

app.listen(PORT, async () => {
  console.log(`API running on http://localhost:${PORT}`);

  try {
    const client = await getClient();
    const wallet = getMasterWallet();
    console.log(`XRPL connected: ${client.isConnected()}`);
    console.log(`Master wallet: ${wallet.address}`);
    const balance = await getAccountBalance(wallet.address);
    console.log(`Master balance: ${balance} XRP`);
  } catch (err: any) {
    console.warn(`XRPL not connected: ${err.message}`);
    console.warn("On-chain operations will fail until XRPL is reachable.");
    console.warn("Group logic (create, join, vote) works offline.\n");
  }

  console.log("\nEndpoints:");
  console.log("  GET  /health");
  console.log("  POST /groups");
  console.log("  GET  /groups");
  console.log("  GET  /groups/:id");
  console.log("  POST /groups/:id/members");
  console.log("  POST /groups/:id/deposit");
  console.log("  POST /groups/:id/withdraw");
  console.log("  GET  /groups/:id/balances");
  console.log("  GET  /groups/:id/voting-weights");
  console.log("  POST /proposals");
  console.log("  GET  /proposals?groupId=xxx");
  console.log("  GET  /proposals/:id");
  console.log("  POST /proposals/:id/vote");
  console.log("  POST /proposals/expire");
  console.log("  POST /settlement/settle");
  console.log("  POST /settlement/batch");
  console.log("  POST /settlement/escrow/:id/finish");
  console.log("  POST /settlement/escrow/:id/cancel");
  console.log("  GET  /settlement/escrows?groupId=xxx");
});
