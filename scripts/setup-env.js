#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");

if (fs.existsSync(envPath)) {
  console.log(".env already exists. Skipping.");
  process.exit(0);
}

const key = crypto.randomBytes(32).toString("hex");
const example = fs.readFileSync(examplePath, "utf8");
// Default DATABASE_URL matches docker-compose.yml so you don't have to set anything
const defaultDbUrl = "postgresql://postgres:postgres@localhost:5432/polymarket_bot?schema=public";
const env = example
  .replace("WALLET_ENCRYPTION_KEY=your_32_byte_hex_key_here", `WALLET_ENCRYPTION_KEY=${key}`)
  .replace(
    'DATABASE_URL="postgresql://user:password@localhost:5432/polymarket_bot?schema=public"',
    `DATABASE_URL="${defaultDbUrl}"`
  );
fs.writeFileSync(envPath, env);
console.log("Created .env with a random WALLET_ENCRYPTION_KEY and default DATABASE_URL.");
console.log("");
console.log("Start PostgreSQL (e.g. Docker):  docker compose up -d");
console.log("Then:                            npx prisma db push && npm run dev");
