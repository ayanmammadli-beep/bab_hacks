/**
 * Mock backend stub.
 *
 * This module is the ONLY integration point between the iMessage layer
 * and the trading backend. All functions here will be replaced with real
 * API calls when the backend (Ripple, Liquid, Polymarket) is ready.
 *
 * Do NOT add trading logic here — this file is intentionally a thin stub.
 */

const COLORS = {
  reset:     '\x1b[0m',
  bold:      '\x1b[1m',
  ripple:    '\x1b[36m',   // cyan
  liquid:    '\x1b[35m',   // magenta
  polymarket:'\x1b[33m',   // yellow
  label:     '\x1b[90m',   // grey
};

function mockCall(service, method, endpoint, payload) {
  const color = COLORS[service.toLowerCase()] ?? COLORS.label;
  console.log(
    `\n${color}${COLORS.bold}[MOCK → ${service}]${COLORS.reset} ` +
    `${COLORS.label}${method} ${endpoint}${COLORS.reset}`
  );
  console.log(`${COLORS.label}  payload:${COLORS.reset}`, JSON.stringify(payload, null, 2)
    .split('\n').map((l, i) => (i === 0 ? l : '  ' + l)).join('\n'));
}

// In-memory state for development/testing
const state = {
  funds: {},          // chatId -> { id, name, total, createdBy }
  proposals: {},      // chatId -> { id, description, proposedBy, messageId, yesVoters, noVoters, status }
  messageToChat: {},  // messageId -> chatId (for reaction lookup)
};

// ─── Fund ─────────────────────────────────────────────────────────────────────

async function createFund({ name, createdBy, chatId }) {
  const fund = {
    id: `fund_${Date.now()}`,
    name,
    createdBy,
    total: 0,
  };
  state.funds[chatId] = fund;

  mockCall('Ripple', 'POST', '/v1/accounts/create',
    { fund_id: fund.id, name, owner: createdBy });

  return fund;
}

async function deposit({ amount, from, chatId }) {
  if (!state.funds[chatId]) {
    state.funds[chatId] = { id: `fund_${Date.now()}`, name: 'My Fund', total: 0 };
  }
  state.funds[chatId].total += amount;

  mockCall('Ripple', 'POST', '/v1/accounts/deposit',
    { fund_id: state.funds[chatId].id, from, amount_usd: amount });

  return { amount, from, fundTotal: state.funds[chatId].total };
}

// ─── Proposals / Voting ───────────────────────────────────────────────────────

const VOTE_THRESHOLD = 0.6; // 60% yes to pass

async function proposeTrade({ description, proposedBy, chatId }) {
  const proposal = {
    id: `prop_${Date.now()}`,
    description,
    proposedBy,
    messageId: null,
    yesVoters: new Set(),
    noVoters: new Set(),
    status: 'open',
  };
  state.proposals[chatId] = proposal;

  // Proposals route to Polymarket (prediction markets) or Liquid (spot/derivatives)
  mockCall('Polymarket', 'POST', '/v1/markets/propose',
    { proposal_id: proposal.id, description, proposed_by: proposedBy, fund_id: state.funds[chatId]?.id });

  return proposal;
}

async function setProposalMessageId({ chatId, messageId }) {
  const proposal = state.proposals[chatId];
  if (!proposal) return;
  proposal.messageId = messageId;
  state.messageToChat[messageId] = chatId;
}

function _tallyProposal(proposal) {
  const yesVotes = proposal.yesVoters.size;
  const noVotes = proposal.noVoters.size;
  const total = yesVotes + noVotes;
  const passed = total > 0 && yesVotes / total >= VOTE_THRESHOLD;
  const failed = total > 0 && noVotes / total > 1 - VOTE_THRESHOLD;
  if (passed) proposal.status = 'passed';
  else if (failed) proposal.status = 'failed';
  return { yesVotes, noVotes, totalVotes: total, passed, failed };
}

async function vote({ choice, voter, chatId }) {
  const proposal = state.proposals[chatId];
  if (!proposal) {
    return { error: 'No active proposal. Use /propose_trade first.' };
  }
  if (proposal.status !== 'open') {
    return { error: `Proposal already ${proposal.status}.` };
  }
  if (proposal.yesVoters.has(voter) || proposal.noVoters.has(voter)) {
    return { error: 'You have already voted on this proposal.' };
  }

  if (choice === 'yes') proposal.yesVoters.add(voter);
  else proposal.noVoters.add(voter);

  const tally = _tallyProposal(proposal);

  if (tally.passed) {
    mockCall('Polymarket', 'POST', '/v1/orders/execute',
      { proposal_id: proposal.id, description: proposal.description, fund_id: state.funds[chatId]?.id });
  }

  return tally;
}

/** Called when a reaction is added to the proposal message. */
async function voteByReaction({ messageId, voter, reactionType }) {
  const chatId = state.messageToChat[messageId];
  if (!chatId) return null; // reaction on a non-proposal message

  const proposal = state.proposals[chatId];
  if (!proposal || proposal.messageId !== messageId) return null;
  if (proposal.status !== 'open') return { chatId, error: `Proposal already ${proposal.status}.` };

  // Remove any prior vote from this voter before adding new one
  proposal.yesVoters.delete(voter);
  proposal.noVoters.delete(voter);

  if (reactionType === 'yes') proposal.yesVoters.add(voter);
  else proposal.noVoters.add(voter);

  const tally = _tallyProposal(proposal);

  if (tally.passed) {
    mockCall('Polymarket', 'POST', '/v1/orders/execute',
      { proposal_id: proposal.id, description: proposal.description, fund_id: state.messageToChat[messageId] && state.funds[state.messageToChat[messageId]]?.id });
  }

  return { chatId, ...tally };
}

/** Called when a reaction is removed from the proposal message. */
async function retractVoteByReaction({ messageId, voter }) {
  const chatId = state.messageToChat[messageId];
  if (!chatId) return null;

  const proposal = state.proposals[chatId];
  if (!proposal || proposal.messageId !== messageId) return null;
  if (proposal.status !== 'open') return null;

  proposal.yesVoters.delete(voter);
  proposal.noVoters.delete(voter);

  const yesVotes = proposal.yesVoters.size;
  const noVotes = proposal.noVoters.size;
  return { chatId, yesVotes, noVotes, totalVotes: yesVotes + noVotes, passed: false, failed: false };
}

// ─── Portfolio ────────────────────────────────────────────────────────────────

async function getPortfolio({ chatId }) {
  const fund = state.funds[chatId];

  mockCall('Ripple',     'GET', `/v1/accounts/${fund?.id ?? 'unknown'}/balance`, {});
  mockCall('Liquid',     'GET', `/v1/portfolio/${fund?.id ?? 'unknown'}`, {});
  mockCall('Polymarket', 'GET', `/v1/positions/${fund?.id ?? 'unknown'}`, {});

  return {
    positions: [],
    totalValue: fund?.total ?? 0,
    totalPct: 0,
  };
}

module.exports = {
  createFund,
  deposit,
  proposeTrade,
  setProposalMessageId,
  vote,
  voteByReaction,
  retractVoteByReaction,
  getPortfolio,
};
