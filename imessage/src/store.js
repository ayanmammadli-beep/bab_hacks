/**
 * Lightweight JSON persistence for cross-service ID mappings.
 *
 * Maps iMessage identifiers (chatId, senderHandle) to backend IDs
 * (XRPL group/member UUIDs, active proposal IDs, etc.)
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/store.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch {
    return { groups: {}, members: {}, proposals: {} };
  }
}

function save(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ─── Groups ───────────────────────────────────────────────────────────────────

/** { chatId → { xrplGroupId } } */
function getGroup(chatId) {
  return load().groups[chatId] ?? null;
}

function setGroup(chatId, data) {
  const db = load();
  db.groups[chatId] = { ...(db.groups[chatId] ?? {}), ...data };
  save(db);
}

// ─── Members ──────────────────────────────────────────────────────────────────

/** { chatId → { senderHandle → xrplMemberId } } */
function getMemberId(chatId, handle) {
  return load().members[chatId]?.[handle] ?? null;
}

function setMemberId(chatId, handle, memberId) {
  const db = load();
  db.members[chatId] ??= {};
  db.members[chatId][handle] = memberId;
  save(db);
}

// ─── Active Proposal ──────────────────────────────────────────────────────────

/**
 * Stores the active proposal per chat so vote handlers can look it up.
 * Shape: { xrplProposalId, type: 'polymarket'|'liquid', polymarketMarketId?, side, amount }
 */
function getProposal(chatId) {
  return load().proposals[chatId] ?? null;
}

function setProposal(chatId, data) {
  const db = load();
  db.proposals[chatId] = data;
  save(db);
}

function clearProposal(chatId) {
  const db = load();
  delete db.proposals[chatId];
  save(db);
}

function recordVote(chatId, handle, choice) {
  const db = load();
  if (!db.proposals[chatId]) return;
  db.proposals[chatId].votes ??= {};
  db.proposals[chatId].votes[handle] = choice;
  save(db);
}

// ─── Chat Members ──────────────────────────────────────────────────────────────
// Tracks everyone who has texted in each chat — used for equal-weight voting
// when no XRPL deposits exist yet.

function addChatMember(chatId, handle) {
  if (!chatId || !handle || handle === 'unknown') return;
  const db = load();
  db.chatMembers ??= {};
  db.chatMembers[chatId] ??= [];
  if (!db.chatMembers[chatId].includes(handle)) {
    db.chatMembers[chatId].push(handle);
    save(db);
  }
}

function getChatMembers(chatId) {
  return load().chatMembers?.[chatId] ?? [];
}

module.exports = { getGroup, setGroup, getMemberId, setMemberId, getProposal, setProposal, clearProposal, recordVote, addChatMember, getChatMembers };
