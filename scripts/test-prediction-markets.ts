/**
 * Prediction market API smoke test.
 * Run with: npm run test:prediction
 * Requires: server running (npm run dev) and DATABASE_URL set (npx prisma db push).
 * Uses simulated groupChatId and user ids; no wallets.
 */
import "dotenv/config";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const GROUP = "test-prediction-" + Date.now();
const USERS = ["alice", "bob", "carol"];

async function request(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  const url = path.startsWith("http") ? path : BASE + path;
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body && (method === "POST" || method === "PUT")) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function ok(name: string, condition: boolean, detail = ""): boolean {
  const icon = condition ? "✓" : "✗";
  console.log(`  ${icon} ${name}` + (detail ? ` ${detail}` : ""));
  return condition;
}

async function main() {
  console.log("\nPrediction markets – API smoke test");
  console.log("BASE_URL:", BASE, "groupChatId:", GROUP, "\n");

  const health = await request("GET", "/health");
  if (health.status !== 200) {
    console.error("  ✗ Server not reachable at", BASE);
    console.error("    Start the server first: npm run dev");
    console.error("    Ensure .env has DATABASE_URL and run: npx prisma db push");
    process.exit(1);
  }

  const predictionRoot = await request("GET", "/prediction-markets");
  if (predictionRoot.status !== 200) {
    console.error("  ✗ Prediction-markets API not found at", BASE);
    console.error("    Got", predictionRoot.status, "- expected 200 for GET /prediction-markets");
    console.error("    Make sure you are running this repo's server (npm run dev from bab_hacks).");
    console.error("    If you restarted, ensure no other process is using the port (e.g. kill other node).");
    process.exit(1);
  }
  console.log("  ✓ Server reachable");
  console.log("  ✓ Prediction-markets routes loaded\n");

  let passed = 0;
  let failed = 0;

  // --- 1. Create proposal (event deadline in the past so we can resolve in same run) ---
  const eventDeadline = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 min ago
  const { status: s1, data: createRes } = await request("POST", "/prediction-markets/proposals", {
    groupChatId: GROUP,
    description: "Will it rain tomorrow?",
    eventDeadline,
    initialLiquidityAmount: 100,
    proposer: USERS[0],
  });
  if (!ok("Create proposal", s1 === 201, `status ${s1}`)) {
    failed++;
    if (s1 === 404) {
      console.log("    Tip: Restart the API server so it loads prediction-markets routes.");
      console.log("    Stop the server (Ctrl+C), then run: npm run dev");
    } else {
      console.log("    response:", createRes);
    }
  } else {
    passed++;
  }

  const proposalId = (createRes as { id?: string }).id;
  if (!proposalId) {
    console.log("    missing proposal id, aborting");
    if (s1 === 404) {
      console.log("    Restart the server (npm run dev) and run this test again.");
    }
    process.exit(1);
  }

  // --- 2. List proposals ---
  const { status: s2, data: listProposals } = await request(
    "GET",
    `/prediction-markets/proposals?groupChatId=${encodeURIComponent(GROUP)}`
  );
  if (!ok("List proposals", s2 === 200 && Array.isArray(listProposals))) {
    failed++;
  } else {
    passed++;
  }

  // --- 3. Vote approve (all three so we pass 60%) ---
  for (const user of USERS) {
    const { status } = await request("POST", `/prediction-markets/proposals/${proposalId}/vote`, {
      userId: user,
      vote: "approve",
      weight: 1,
    });
    if (!ok(`Vote approve (${user})`, status === 200)) failed++;
    else passed++;
  }

  // --- 4. Execute proposal → create market ---
  const { status: s4, data: execRes } = await request(
    "POST",
    `/prediction-markets/proposals/${proposalId}/execute`
  );
  const marketId = (execRes as { marketId?: string }).marketId;
  if (!ok("Execute proposal (create market)", s4 === 201 || s4 === 200, `status ${s4}`)) {
    failed++;
    console.log("    response:", execRes);
  } else if (!marketId) {
    ok("Get marketId", false, "missing marketId");
    failed++;
  } else {
    passed++;
  }

  if (!marketId) {
    console.log("\nAborting (no marketId).");
    process.exit(1);
  }

  // --- 5. List markets ---
  const { status: s5, data: markets } = await request(
    "GET",
    `/prediction-markets/markets?groupChatId=${encodeURIComponent(GROUP)}`
  );
  if (!ok("List markets", s5 === 200 && Array.isArray(markets) && markets.length >= 1)) {
    failed++;
  } else {
    passed++;
  }

  // --- 6. Place bets: alice YES 20, bob NO 30, carol YES 10 ---
  const bets: [string, number, "YES" | "NO"][] = [
    [USERS[0], 20, "YES"],
    [USERS[1], 30, "NO"],
    [USERS[2], 10, "YES"],
  ];
  for (const [user, amount, side] of bets) {
    const { status } = await request("POST", `/prediction-markets/markets/${marketId}/bets`, {
      userId: user,
      amount,
      side,
    });
    if (!ok(`Place bet ${user} ${side} ${amount}`, status === 201)) failed++;
    else passed++;
  }

  // --- 7. Get market (triggers RESOLUTION_OPEN because eventDeadline passed) ---
  const { status: s7, data: market } = await request(
    "GET",
    `/prediction-markets/markets/${marketId}`
  );
  if (!ok("Get market (resolution open)", s7 === 200)) {
    failed++;
  } else {
    passed++;
  }
  const status = (market as { status?: string })?.status;
  if (status !== "RESOLUTION_OPEN" && status !== "RESOLVED") {
    console.log(`    (status is ${status}; resolution may open on first GET after deadline)`);
  }

  // --- 8. Resolution votes: alice YES, bob NO, carol YES → majority YES ---
  // With 60% threshold, the first vote (alice YES) can resolve immediately; later votes may get "already resolved"
  const resolutionVotes: [string, "YES" | "NO"][] = [
    [USERS[0], "YES"],
    [USERS[1], "NO"],
    [USERS[2], "YES"],
  ];
  let resolved = false;
  for (const [user, outcome] of resolutionVotes) {
    const { status: s8, data: voteRes } = await request(
      "POST",
      `/prediction-markets/markets/${marketId}/resolution-votes`,
      { userId: user, outcome }
    );
    const voteOk = s8 === 200;
    if (!voteOk) {
      const m = await request("GET", `/prediction-markets/markets/${marketId}`);
      const marketStatus = (m.data as { status?: string })?.status;
      if (marketStatus === "RESOLVED") {
        if (ok(`Resolution vote ${user} ${outcome} (market already resolved)`, true)) passed++;
      } else {
        if (!ok(`Resolution vote ${user} ${outcome}`, false, `status ${s8}`)) failed++;
      }
    } else {
      if (ok(`Resolution vote ${user} ${outcome}`, true)) passed++;
    }
    if ((voteRes as { status?: string })?.status === "resolved") resolved = true;
  }

  if (!resolved) {
    const { data: m2 } = await request("GET", `/prediction-markets/markets/${marketId}`);
    if ((m2 as { status?: string }).status === "RESOLVED") resolved = true;
    else console.log("    market status after votes:", (m2 as { status?: string }).status);
  }

  // --- 9. Get payouts (must be resolved first) ---
  const { status: s9, data: payouts } = await request(
    "GET",
    `/prediction-markets/markets/${marketId}/payouts`
  );
  if (!ok("Get payouts", s9 === 200)) {
    failed++;
    if (s9 !== 200) console.log("    (market may not be resolved yet)", payouts);
  } else {
    passed++;
    const p = payouts as { winningSide?: string; liquidityReturned?: string; payouts?: Array<{ userId: string; amount: string }> };
    console.log("    winningSide:", p.winningSide, "liquidityReturned:", p.liquidityReturned);
    if (Array.isArray(p.payouts) && p.payouts.length) {
      console.log("    winner payouts:", p.payouts.map((x) => `${x.userId}: ${x.amount}`).join(", "));
    }
  }

  console.log("\n---");
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
