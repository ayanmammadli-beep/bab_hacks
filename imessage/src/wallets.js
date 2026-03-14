const fs = require('fs');
const path = require('path');
const { Wallet } = require('xrpl');

const DB_PATH = path.join(__dirname, '../data/wallets.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function save(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

/**
 * Returns the existing XRP wallet for a phone number,
 * or creates and persists a new one.
 */
function getOrCreate(phone) {
  const db = load();
  if (db[phone]) return db[phone];

  const wallet = Wallet.generate();
  const entry = { address: wallet.address, seed: wallet.seed };
  db[phone] = entry;
  save(db);

  console.log(`[wallets] created XRP wallet for ${phone}: ${wallet.address}`);
  return entry;
}

function get(phone) {
  return load()[phone] ?? null;
}

/**
 * Returns an XRPL payment URI for topping up a wallet.
 * Optionally pre-fills an amount in XRP.
 */
function topupLink(address, amountXrp) {
  const base = `https://bithomp.com/explorer/${address}`;
  return amountXrp ? `${base}?amount=${amountXrp}` : base;
}

module.exports = { getOrCreate, get, topupLink };
