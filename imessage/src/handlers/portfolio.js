const responder = require('../responder');
const backend = require('../backend');

/**
 * /portfolio
 * Shows both the reserve vault (XRPL, drives voting) and the trading vault (positions).
 */
async function portfolio(_args, { chatId }) {
  const result = await backend.getPortfolio({ chatId });
  const { reserve, trading } = result;

  // ── Reserve vault ──────────────────────────────────────────────────────────
  const reserveLines = reserve.members.length > 0
    ? reserve.members.map(m =>
        `  ${m.handle}: ${m.amount.toFixed(2)} XRP (${(m.votingWeight * 100).toFixed(1)}% vote)`
      )
    : ['  no deposits yet'];

  // ── Trading vault ──────────────────────────────────────────────────────────
  const tradingLines = trading.positions.length > 0
    ? trading.positions.map(p =>
        `  • ${p.name}: ${p.value >= 0 ? '+' : ''}$${p.value.toFixed(2)} (${p.pct >= 0 ? '+' : ''}${p.pct.toFixed(1)}%)`
      )
    : ['  no open positions'];

  const reply =
    `Reserve Vault (XRPL)\n` +
    `${reserveLines.join('\n')}\n` +
    `Total: ${reserve.total.toFixed(2)} XRP\n` +
    `\n` +
    `Trading Vault\n` +
    `${tradingLines.join('\n')}\n` +
    `Total: $${trading.total.toFixed(2)} ${trading.currency}`;

  await responder.send(chatId, reply);
}

module.exports = portfolio;
