/**
 * Backend stub — dual-vault architecture.
 *
 * RESERVE VAULT  (XRPL-API)  — tracks deposits & drives voting weights.
 * TRADING VAULT  (TBD)       — holds funds actually used to trade on Polymarket / Liquid.
 *
 * This is the ONLY integration point between the iMessage layer and the
 * backend services. Replace each mockCall() block with a real axios/fetch
 * call once the corresponding backend is ready.
 *
 * Do NOT add trading logic here.
 */

const COLORS = {
  reset:        '\x1b[0m',
  bold:         '\x1b[1m',
  ripple:       '\x1b[36m',   // cyan   — XRPL reserve vault
  trading:      '\x1b[32m',   // green  — trading vault
  liquid:       '\x1b[35m',   // magenta
  polymarket:   '\x1b[33m',   // yellow
  label:        '\x1b[90m',   // grey
};

function mockCall(service, method, endpoint, payload) {
  const key = service.toLowerCase().split(' ')[0];
  const color = COLORS[key] ?? COLORS.label;
  console.log(
    `\n${color}${COLORS.bold}[MOCK → ${service}]${COLORS.reset} ` +
    `${COLORS.label}${method} ${endpoint}${COLORS.reset}`
  );
  console.log(`${COLORS.label}  payload:${COLORS.reset}`, JSON.stringify(payload, null, 2)
    .split('\n').map((l, i) => (i === 0 ? l : '  ' + l)).join('\n'));
}

// ─── In-memory state (dev/test only) ──────────────────────────────────────────

const state = {
  funds:          {},   // chatId → { id, name, createdBy }
  // Reserve vault: member XRP deposits (drives voting weight)
  reserveBalances: {},  // chatId → { [memberHandle]: amountXrp }
  // Trading vault: separate balance used for actual trades
  tradingBalance:  {},  // chatId → { total, currency }
  proposals:       {},  // chatId → { id, description, proposedBy, messageId, votes: { [handle]: 'yes'|'no' }, status }
  messageToChat:   {},  // messageId → chatId
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns each member's voting weight based on their XRPL reserve deposit. */
function _votingWeights(chatId) {
  const balances = state.reserveBalances[chatId] ?? {};
  const total = Object.values(balances).reduce((s, v) => s + v, 0);
  if (total === 0) return {};
  return Object.fromEntries(
    Object.entries(balances).map(([handle, amt]) => [handle, amt / total])
  );
}

/** Tallies a proposal using reserve-vault voting weights. */
function _tallyProposal(proposal, chatId) {
  const weights = _votingWeights(chatId);
  let yes = 0, no = 0;

  for (const [voter, choice] of Object.entries(proposal.votes)) {
    const w = weights[voter] ?? (1 / Math.max(Object.keys(proposal.votes).length, 1));
    if (choice === 'yes') yes += w;
    else no += w;
  }

  const total = yes + no;
  const passed = total > 0 && yes / total >= VOTE_THRESHOLD;
  const failed = total > 0 && no / total > 1 - VOTE_THRESHOLD;
  if (passed) proposal.status = 'passed';
  else if (failed) proposal.status = 'failed';

  return { yesWeight: yes, noWeight: no, passed, failed };
}

const VOTE_THRESHOLD = 0.6;

// ─── Fund ─────────────────────────────────────────────────────────────────────

async function createFund({ name, createdBy, chatId }) {
  const fund = { id: `fund_${Date.now()}`, name, createdBy };
  state.funds[chatId] = fund;
  state.reserveBalances[chatId] = {};
  state.tradingBalance[chatId] = { total: 0, currency: 'XRP' };

  // TODO: replace with POST to XRPL-API /groups
  mockCall('Ripple Reserve Vault', 'POST', '/groups',
    { fund_id: fund.id, name, owner: createdBy });

  // TODO: replace with POST to trading vault API /funds/create
  mockCall('Trading Vault', 'POST', '/funds/create',
    { fund_id: fund.id, name });

  return fund;
}

// ─── Deposit ──────────────────────────────────────────────────────────────────

/** Deposit into the XRPL reserve vault — increases the member's voting weight. */
async function depositToReserve({ amount, from, chatId }) {
  if (!state.funds[chatId]) {
    state.funds[chatId] = { id: `fund_${Date.now()}`, name: 'My Fund', createdBy: from };
    state.reserveBalances[chatId] = {};
  }
  state.reserveBalances[chatId][from] = (state.reserveBalances[chatId][from] ?? 0) + amount;

  // TODO: replace with POST to XRPL-API /groups/:id/deposit
  mockCall('Ripple Reserve Vault', 'POST', `/groups/${state.funds[chatId].id}/deposit`,
    { from, amount_xrp: amount });

  const weights = _votingWeights(chatId);
  return { amount, from, votingWeight: weights[from] ?? 0 };
}

/** Deposit into the trading vault — funds used for actual Polymarket / Liquid trades. */
async function depositToTrading({ amount, from, chatId }) {
  if (!state.tradingBalance[chatId]) {
    state.tradingBalance[chatId] = { total: 0, currency: 'USD' };
  }
  state.tradingBalance[chatId].total += amount;

  // TODO: replace with POST to trading vault API /funds/:id/deposit
  mockCall('Trading Vault', 'POST', `/funds/${state.funds[chatId]?.id ?? 'unknown'}/deposit`,
    { from, amount_usd: amount });

  return { amount, from, tradingTotal: state.tradingBalance[chatId].total };
}

// keep legacy alias so nothing else breaks
async function deposit(args) { return depositToReserve(args); }

// ─── Proposals / Voting ───────────────────────────────────────────────────────

async function proposeTrade({ description, proposedBy, chatId }) {
  const proposal = {
    id: `prop_${Date.now()}`,
    description,
    proposedBy,
    messageId: null,
    votes: {},
    status: 'open',
  };
  state.proposals[chatId] = proposal;

  // TODO: replace with POST to XRPL-API /proposals (which also notifies trading vault)
  mockCall('Ripple Reserve Vault', 'POST', '/proposals',
    { proposal_id: proposal.id, description, proposed_by: proposedBy, fund_id: state.funds[chatId]?.id });

  return proposal;
}

async function setProposalMessageId({ chatId, messageId }) {
  const proposal = state.proposals[chatId];
  if (!proposal) return;
  proposal.messageId = messageId;
  state.messageToChat[messageId] = chatId;
}

async function vote({ choice, voter, chatId }) {
  const proposal = state.proposals[chatId];
  if (!proposal) return { error: 'No active proposal. Use /propose_trade first.' };
  if (proposal.status !== 'open') return { error: `Proposal already ${proposal.status}.` };

  proposal.votes[voter] = choice;
  const tally = _tallyProposal(proposal, chatId);

  // TODO: replace with POST to XRPL-API /proposals/:id/vote
  mockCall('Ripple Reserve Vault', 'POST', `/proposals/${proposal.id}/vote`,
    { voter, choice, fund_id: state.funds[chatId]?.id });

  if (tally.passed) {
    // Trading vault executes the trade — Polymarket or Liquid depending on description
    // TODO: replace with POST to trading vault API /proposals/:id/execute
    mockCall('Trading Vault', 'POST', `/proposals/${proposal.id}/execute`,
      { description: proposal.description, fund_id: state.funds[chatId]?.id });
  }

  return tally;
}

async function voteByReaction({ messageId, voter, reactionType }) {
  const chatId = state.messageToChat[messageId];
  if (!chatId) return null;

  const proposal = state.proposals[chatId];
  if (!proposal || proposal.messageId !== messageId) return null;
  if (proposal.status !== 'open') return { chatId, error: `Proposal already ${proposal.status}.` };

  proposal.votes[voter] = reactionType; // 'yes' or 'no'
  const tally = _tallyProposal(proposal, chatId);

  mockCall('Ripple Reserve Vault', 'POST', `/proposals/${proposal.id}/vote`,
    { voter, choice: reactionType, fund_id: state.funds[chatId]?.id });

  if (tally.passed) {
    mockCall('Trading Vault', 'POST', `/proposals/${proposal.id}/execute`,
      { description: proposal.description, fund_id: state.funds[chatId]?.id });
  }

  return { chatId, ...tally };
}

async function retractVoteByReaction({ messageId, voter }) {
  const chatId = state.messageToChat[messageId];
  if (!chatId) return null;

  const proposal = state.proposals[chatId];
  if (!proposal || proposal.messageId !== messageId) return null;
  if (proposal.status !== 'open') return null;

  delete proposal.votes[voter];
  const tally = _tallyProposal(proposal, chatId);
  return { chatId, ...tally, passed: false, failed: false };
}

// ─── Portfolio ────────────────────────────────────────────────────────────────

async function getPortfolio({ chatId }) {
  const fund = state.funds[chatId];
  const reserveBalances = state.reserveBalances[chatId] ?? {};
  const tradingBalance = state.tradingBalance[chatId] ?? { total: 0, currency: 'XRP' };

  // TODO: replace with GET to XRPL-API /groups/:id/balances
  mockCall('Ripple Reserve Vault', 'GET', `/groups/${fund?.id ?? 'unknown'}/balances`, {});

  // TODO: replace with GET to trading vault API /funds/:id/portfolio
  mockCall('Trading Vault', 'GET', `/funds/${fund?.id ?? 'unknown'}/portfolio`, {});

  const reserveTotal = Object.values(reserveBalances).reduce((s, v) => s + v, 0);
  const weights = _votingWeights(chatId);

  return {
    // Reserve vault — XRPL, drives voting
    reserve: {
      total: reserveTotal,
      currency: 'XRP',
      members: Object.entries(reserveBalances).map(([handle, amt]) => ({
        handle,
        amount: amt,
        votingWeight: weights[handle] ?? 0,
      })),
    },
    // Trading vault — actual positions on Polymarket / Liquid
    trading: {
      total: tradingBalance.total,
      currency: tradingBalance.currency,
      positions: [], // TODO: populated from trading vault API
    },
  };
}

module.exports = {
  createFund,
  deposit,
  depositToReserve,
  depositToTrading,
  proposeTrade,
  setProposalMessageId,
  vote,
  voteByReaction,
  retractVoteByReaction,
  getPortfolio,
};
