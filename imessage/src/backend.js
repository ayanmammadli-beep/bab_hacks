/**
 * Backend integration layer — dual-vault architecture.
 *
 * RESERVE VAULT  → XRPL-API   (tracks deposits, drives voting weights, escrow)
 * TRADING VAULT  → Polymarket backend (/src) for prediction markets
 *                  XRPL-API Liquid integration for derivatives
 *
 * All cross-service state (group IDs, member IDs, proposal IDs) is persisted
 * locally in data/store.json via store.js.
 */

const crypto = require('crypto');
const axios = require('axios');
const wallets = require('./wallets');
const store = require('./store');

const xrplApi    = axios.create({ baseURL: process.env.XRPL_API_URL    || 'http://localhost:3001' });
const polymarket = axios.create({ baseURL: process.env.POLYMARKET_API_URL || 'http://localhost:3002' });

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Ensures a member exists in the XRPL-API for this chat/handle combo.
 * Creates the member on first call and caches the memberId locally.
 */
async function ensureMember(chatId, handle) {
  const cached = store.getMemberId(chatId, handle);
  if (cached) return cached;

  const group = store.getGroup(chatId);
  if (!group?.xrplGroupId) throw new Error('No fund found for this chat. Create one with /createfund first.');

  const wallet = wallets.getOrCreate(handle);
  const { data } = await xrplApi.post(`/groups/${group.xrplGroupId}/members`, {
    handle,
    xrplAddress: wallet.address,
  });

  store.setMemberId(chatId, handle, data.id);
  return data.id;
}

// ─── Fund ─────────────────────────────────────────────────────────────────────

async function createFund({ name, createdBy, chatId }) {
  // 1. Create XRPL reserve vault group
  const { data: group } = await xrplApi.post('/groups', { name });
  store.setGroup(chatId, { xrplGroupId: group.id });

  // 2. Create Polymarket wallet for this chat
  await polymarket.post(`/wallets/${chatId}`).catch(() => {
    // Non-fatal — wallet creation can be retried on first trade
    console.warn('[backend] polymarket wallet creation failed, will retry on first trade');
  });

  return { id: group.id, name };
}

// ─── Deposits ─────────────────────────────────────────────────────────────────

/** Records a deposit to the XRPL reserve vault (increases voting weight). */
async function depositToReserve({ amount, from, chatId }) {
  const group = store.getGroup(chatId);
  if (!group?.xrplGroupId) {
    // Auto-create fund if none exists
    await createFund({ name: 'My Fund', createdBy: from, chatId });
  }

  const memberId = await ensureMember(chatId, from);
  const groupId = store.getGroup(chatId).xrplGroupId;

  const { data } = await xrplApi.post(`/groups/${groupId}/deposit`, { memberId, amount });

  const memberShare = data.groupBalance?.members?.find(m => m.memberId === memberId);
  return { amount, from, votingWeight: memberShare?.sharePercent ?? 0 };
}

/** Records a deposit to the Polymarket trading vault. */
async function depositToTrading({ amount, from, chatId }) {
  const { data } = await polymarket.post(`/wallets/${chatId}/fund`, { amount });
  return { amount, from, tradingTotal: parseFloat(data.usdcBalance) };
}

// ─── Proposals ────────────────────────────────────────────────────────────────

/**
 * Creates a trade proposal stored locally — no XRPL needed.
 * XRPL is only consulted at vote time to get weighted voting shares.
 */
async function proposeTrade({ chatId, proposedBy, type, description, market, side, amount }) {
  // For Polymarket: resolve the condition_id from a plain-English search
  let resolvedMarket = market;
  if (type === 'polymarket' && !market.startsWith('0x')) {
    const { data: markets } = await polymarket.get('/markets', { params: { search: market } });
    if (!markets.length) throw new Error(`No Polymarket market found for "${market}". Try a more specific description.`);
    resolvedMarket = markets[0].condition_id;
  }

  const proposalId = crypto.randomUUID();
  store.setProposal(chatId, {
    id: proposalId,
    type,
    polymarketMarketId: type === 'polymarket' ? resolvedMarket : null,
    market: resolvedMarket,
    side,
    amount,
    description,
    proposedBy,
    votes: {},
  });

  return { id: proposalId, description, market: resolvedMarket, side, amount };
}

// ─── Voting ───────────────────────────────────────────────────────────────────

async function vote({ choice, voter, chatId }) {
  const proposal = store.getProposal(chatId);
  if (!proposal) return { error: 'No active proposal. Use /propose_trade first.' };

  // Record vote locally
  store.recordVote(chatId, voter, choice);
  const votes = store.getProposal(chatId).votes ?? {};

  // Try to get XRPL voting weights — only use if someone has actually deposited
  let handleToWeight = null;
  const group = store.getGroup(chatId);
  if (group?.xrplGroupId) {
    try {
      const { data } = await xrplApi.get(`/groups/${group.xrplGroupId}/voting-weights`);
      const hasDeposits = Object.values(data).some(info => info.deposited > 0);
      if (hasDeposits) {
        handleToWeight = {};
        for (const info of Object.values(data)) {
          handleToWeight[info.handle] = info.weight;
        }
      }
    } catch {
      // XRPL unavailable — fall through to equal weights
    }
  }

  // Equal-weight fallback: divide by total known members, not just voters
  // (prevents first voter from instantly passing by being 1/1 = 100%)
  if (!handleToWeight) {
    const members = store.getChatMembers(chatId);
    // Union of known members + anyone who has already voted
    const allHandles = [...new Set([...members, ...Object.keys(votes)])];
    const n = allHandles.length;
    handleToWeight = {};
    for (const h of allHandles) handleToWeight[h] = 1 / n;
  }

  // Tally
  let yesWeight = 0, noWeight = 0;
  for (const [handle, v] of Object.entries(votes)) {
    const w = handleToWeight[handle] ?? 0;
    if (v === 'yes') yesWeight += w;
    else noWeight += w;
  }

  const THRESHOLD = 0.5;
  const passed = yesWeight > THRESHOLD;
  const failed = noWeight >= THRESHOLD;

  if (passed) {
    if (proposal.type === 'polymarket') {
      await _executePolymarketTrade(chatId, proposal).catch(err => {
        console.error('[backend] polymarket execution failed:', err?.response?.data ?? err.message);
      });
    } else if (proposal.type === 'liquid') {
      await _executeLiquidTrade(proposal).catch(err => {
        console.error('[backend] liquid execution failed:', err?.response?.data ?? err.message);
      });
    }
  }

  if (passed || failed) store.clearProposal(chatId);

  return { yesWeight, noWeight, passed, failed };
}

/** Executes a passed Polymarket trade via the Polymarket backend. */
async function _executePolymarketTrade(chatId, proposal) {
  // Ensure wallet exists
  await polymarket.post(`/wallets/${chatId}`).catch(() => {});

  // Create proposal in Polymarket backend
  const { data: pmProposal } = await polymarket.post('/proposals', {
    groupChatId: chatId,
    marketId: proposal.polymarketMarketId,
    amount: proposal.amount,
    proposer: 'system',
    side: proposal.side.toUpperCase(),
  });

  // Force-approve with full weight and execute
  await polymarket.post(`/proposals/${pmProposal.id}/vote`, {
    userId: 'system',
    vote: 'approve',
    weight: 1,
  });

  await polymarket.post(`/proposals/${pmProposal.id}/execute`);
}

/** Executes a passed Liquid derivatives trade via XRPL-API's Liquid integration. */
async function _executeLiquidTrade(proposal) {
  // Normalize symbol: "BTC" → "BTC-PERP", "BTC-PERP" → "BTC-PERP"
  const symbol = proposal.market.toUpperCase().endsWith('-PERP')
    ? proposal.market.toUpperCase()
    : `${proposal.market.toUpperCase()}-PERP`;

  const side = (proposal.side === 'long' || proposal.side === 'yes') ? 'buy' : 'sell';

  const { data } = await xrplApi.post('/api/orders', {
    symbol,
    side,
    quantity: proposal.amount,
    orderType: 'market',
  });

  console.log('[backend] liquid order placed:', data);
  return data;
}

async function voteByReaction({ messageId, voter, reactionType }) {
  // Look up chatId from proposal store
  const db = require('./store');
  // Find the chatId that owns a proposal linked to this messageId
  // (stored when we call setProposalMessageId)
  const chatId = _messageIdToChatId[messageId];
  if (!chatId) return null;

  const result = await vote({ choice: reactionType, voter, chatId });
  return { chatId, ...result };
}

async function retractVoteByReaction({ messageId, voter }) {
  // Retracting a reaction doesn't change an XRPL vote once cast — no-op
  return null;
}

// In-memory map for reaction → chatId lookup (not worth persisting to disk)
const _messageIdToChatId = {};

async function setProposalMessageId({ chatId, messageId }) {
  _messageIdToChatId[messageId] = chatId;
}

// ─── Portfolio ────────────────────────────────────────────────────────────────

// ─── Voter Allocation ─────────────────────────────────────────────────────────

/**
 * Returns each member's XRP deposit and share percent from the reserve vault.
 * Shape: { totalDeposited, members: [{ memberId, handle, deposited, sharePercent }] }
 */
async function getVoterAllocation({ chatId }) {
  const group = store.getGroup(chatId);
  if (!group?.xrplGroupId) {
    return { totalDeposited: 0, members: [] };
  }
  const { data } = await xrplApi.get(`/groups/${group.xrplGroupId}/balances`);
  return {
    totalDeposited: parseFloat(data.totalDeposited ?? 0),
    members: (data.members ?? []).map(m => ({
      memberId: m.memberId,
      handle: m.handle,
      deposited: parseFloat(m.deposited ?? 0),
      sharePercent: parseFloat(m.sharePercent ?? 0),
    })),
  };
}

async function getPortfolio({ chatId }) {
  const group = store.getGroup(chatId);

  if (!group?.xrplGroupId) {
    return {
      reserve: { total: 0, currency: 'XRP', members: [] },
      trading: { total: 0, currency: 'USDC', positions: [] },
    };
  }

  const [xrplRes, pmRes] = await Promise.allSettled([
    xrplApi.get(`/groups/${group.xrplGroupId}/portfolio`),
    polymarket.get('/positions', { params: { groupChatId: chatId } }),
  ]);

  // Reserve vault (XRPL)
  const xrpl = xrplRes.status === 'fulfilled' ? xrplRes.value.data : null;
  const reserve = {
    total: parseFloat(xrpl?.vault?.totalXRP ?? 0),
    currency: 'XRP',
    members: (xrpl?.memberShares ?? []).map(m => ({
      handle: m.handle,
      amount: m.deposited,
      votingWeight: m.sharePercent / 100,
    })),
  };

  // Trading vault (Polymarket positions)
  const positions = pmRes.status === 'fulfilled' ? pmRes.value.data : [];
  const tradingTotal = positions.reduce((sum, p) => sum + parseFloat(p.avgPrice ?? 0) * parseFloat(p.shares ?? 0), 0);
  const trading = {
    total: tradingTotal,
    currency: 'USDC',
    positions: positions.map(p => ({
      name: p.outcomeLabel ?? p.side ?? p.marketId,
      value: parseFloat(p.currentPrice ?? 0) * parseFloat(p.shares ?? 0),
      pct: parseFloat(p.avgPrice) > 0 ? ((parseFloat(p.currentPrice) - parseFloat(p.avgPrice)) / parseFloat(p.avgPrice)) * 100 : 0,
    })),
  };

  return { reserve, trading };
}

module.exports = {
  createFund,
  deposit: depositToReserve, // legacy alias
  depositToReserve,
  depositToTrading,
  proposeTrade,
  setProposalMessageId,
  vote,
  voteByReaction,
  retractVoteByReaction,
  getPortfolio,
  getVoterAllocation,
};
