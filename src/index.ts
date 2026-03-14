import "dotenv/config";
import express from "express";
import { config } from "./config.js";
import marketsRouter from "./routes/markets.js";
import proposalsRouter from "./routes/proposals.js";
import positionsRouter from "./routes/positions.js";

const app = express();
app.use(express.json());

app.use("/markets", marketsRouter);
app.use("/proposals", proposalsRouter);
app.use("/positions", positionsRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(config.port, () => {
  console.log(`Polymarket group bot API listening on port ${config.port}`);
});
