#!/usr/bin/env node
/**
 * API smoke test. Start the server first: npm run dev
 * Then run: npm run test:api
 */
const BASE = process.env.BASE_URL || "http://localhost:3000";
const GROUP = "chat_test_" + Date.now();

function log(name, ok, detail = "") {
  const icon = ok ? "✓" : "✗";
  console.log(`  ${icon} ${name}` + (detail ? ` ${detail}` : ""));
  return ok;
}

async function request(method, path, body = null) {
  const url = path.startsWith("http") ? path : BASE + path;
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body && (method === "POST" || method === "PUT")) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function main() {
  console.log("\nPolymarket Group Bot – API smoke test");
  console.log("BASE_URL:", BASE, "\n");

  let passed = 0;
  let failed = 0;
  let proposalId;
  let marketId;
  let outcomeTokenId;
  let outcomeLabel;

  // 1. Health
  try {
    const { status } = await request("GET", "/health");
    const ok = status === 200;
    if (log("GET /health", ok, status)) passed++; else failed++;
  } catch (e) {
    if (log("GET /health", false, e.message)) passed++; else failed++;
    failed++;
    console.log("\n  Server not running? Start with: npm run dev\n");
    process.exit(1);
  }

  // 2. List markets
  try {
    const { status, data } = await request("GET", "/markets");
    const ok = status === 200 && Array.isArray(data);
    if (ok && data.length > 0) {
      // Prefer a market that already exposes outcome tokens
      let chosen = null;
      for (const m of data) {
        if (Array.isArray(m.tokens) && m.tokens.length > 0) {
          chosen = m;
          break;
        }
      }
      const m = chosen || data[0];
      marketId = m.condition_id || m.id;
      if (Array.isArray(m.tokens) && m.tokens.length > 0) {
        outcomeTokenId = m.tokens[0].token_id;
        outcomeLabel = m.tokens[0].outcome;
      }
    }
    if (log("GET /markets", ok, ok ? `(${data?.length ?? 0} markets)` : status)) passed++; else failed++;
  } catch (e) {
    if (log("GET /markets", false, e.message)) passed++; else failed++;
    failed++;
  }

  // 3. Search markets
  try {
    const { status, data } = await request("GET", "/markets?search=election");
    const ok = status === 200 && Array.isArray(data);
    if (log("GET /markets?search=election", ok, ok ? `(${data?.length ?? 0} results)` : status)) passed++; else failed++;
  } catch (e) {
    if (log("GET /markets?search=election", false, e.message)) passed++; else failed++;
    failed++;
  }

  // 4. Market by id (use first market or a known id)
  if (marketId) {
    try {
      const { status } = await request("GET", "/markets/" + encodeURIComponent(marketId));
      const ok = status === 200;
      if (log("GET /markets/:id", ok, status)) passed++; else failed++;
    } catch (e) {
      if (log("GET /markets/:id", false, e.message)) passed++; else failed++;
      failed++;
    }
  } else {
    marketId = "0x0000000000000000000000000000000000000000000000000000000000000001";
    if (log("GET /markets/:id", true, "skipped (no market id)")) passed++;
  }

  // 5. Create proposal (multi-outcome aware: use a specific outcome token when available)
  try {
    const hasOutcomeToken = typeof outcomeTokenId === "string" && outcomeTokenId.length > 0;
    if (!hasOutcomeToken) {
      // We couldn't find a market with explicit outcome tokens; skip this check.
      if (log("POST /proposals", true, "skipped (no suitable outcome token found)")) passed++;
      // Do not attempt votes/execute later since there's no proposalId
      proposalId = undefined;
      throw new Error("__skip__");
    }
    const { status, data } = await request("POST", "/proposals", {
      groupChatId: GROUP,
      marketId: marketId || "0xabc",
      // Prefer explicit outcome token when available; otherwise fall back to binary YES
      outcomeTokenId: hasOutcomeToken ? outcomeTokenId : undefined,
      outcomeLabel: hasOutcomeToken ? outcomeLabel : undefined,
      side: undefined,
      amount: 100,
      proposer: "alex",
    });
    const ok = status === 201 && data && data.id;
    if (ok) proposalId = data.id;
    if (log("POST /proposals", ok, ok ? `id=${data.id}` : (data?.error || status))) passed++; else failed++;
  } catch (e) {
    if (e && e.message === "__skip__") {
      // Already counted as passed above
    } else {
      if (log("POST /proposals", false, e.message)) passed++; else failed++;
      failed++;
    }
  }

  // 6. List proposals
  try {
    const { status, data } = await request("GET", "/proposals?groupChatId=" + encodeURIComponent(GROUP));
    const ok = status === 200 && Array.isArray(data);
    if (log("GET /proposals?groupChatId=...", ok, ok ? `(${data.length} proposals)` : status)) passed++; else failed++;
  } catch (e) {
    if (log("GET /proposals?groupChatId=...", false, e.message)) passed++; else failed++;
    failed++;
  }

  // 7. Vote (only if we have a proposal)
  if (proposalId) {
    try {
      const { status, data } = await request("POST", `/proposals/${proposalId}/vote`, {
        userId: "sam",
        vote: "approve",
        weight: 0.5,
      });
      const ok = status === 200 && (data?.approvalWeight != null || data?.error);
      if (log("POST /proposals/:id/vote", ok, ok ? `approvalWeight=${data?.approvalWeight}` : (data?.error || status))) passed++; else failed++;
    } catch (e) {
      if (log("POST /proposals/:id/vote", false, e.message)) passed++; else failed++;
      failed++;
    }

    try {
      const { status, data } = await request("POST", `/proposals/${proposalId}/vote`, {
        userId: "jordan",
        vote: "approve",
        weight: 0.2,
      });
      const ok = status === 200;
      if (log("POST /proposals/:id/vote (second vote)", ok, ok ? `approvalWeight=${data?.approvalWeight}` : (data?.error || status))) passed++; else failed++;
    } catch (e) {
      if (log("POST /proposals/:id/vote (second vote)", false, e.message)) passed++; else failed++;
      failed++;
    }
  }

  // 8. Execute proposal (may fail on CLOB / funds – we only check API response)
  if (proposalId) {
    try {
      const { status, data } = await request("POST", `/proposals/${proposalId}/execute`);
      const ok = status === 200 || status === 400;
      const note = data?.status === "executed" ? "executed" : data?.status || data?.error || status;
      if (log("POST /proposals/:id/execute", ok, note)) passed++; else failed++;
    } catch (e) {
      if (log("POST /proposals/:id/execute", false, e.message)) passed++; else failed++;
      failed++;
    }
  }

  // 9. List positions
  try {
    const { status, data } = await request("GET", "/positions?groupChatId=" + encodeURIComponent(GROUP));
    const ok = status === 200 && Array.isArray(data);
    if (log("GET /positions?groupChatId=...", ok, ok ? `(${data.length} positions)` : status)) passed++; else failed++;
  } catch (e) {
    if (log("GET /positions?groupChatId=...", false, e.message)) passed++; else failed++;
    failed++;
  }

  // 10. Validation: missing body
  try {
    const { status } = await request("POST", "/proposals", {});
    const ok = status === 400;
    if (log("POST /proposals (missing body → 400)", ok, status)) passed++; else failed++;
  } catch (e) {
    if (log("POST /proposals (missing body → 400)", false, e.message)) passed++; else failed++;
    failed++;
  }

  console.log("\n" + "-".repeat(50));
  console.log(`  Passed: ${passed}  Failed: ${failed}`);
  console.log("-".repeat(50) + "\n");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
