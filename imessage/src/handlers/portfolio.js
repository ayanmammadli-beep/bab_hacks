const responder = require('../responder');
const backend = require('../backend');

/**
 * /portfolio
 * Shows the fund's current portfolio.
 */
async function portfolio(_args, { chatId }) {
  const result = await backend.getPortfolio({ chatId });

  if (!result.positions || result.positions.length === 0) {
    return responder.send(chatId, `portfolio empty. the fund is just vibing with $${result.totalValue.toFixed(2)} in cash.\n\npropose something with /propose_trade 👀`);
  }

  const lines = result.positions.map(
    (p) => `• ${p.name}: ${p.value >= 0 ? '+' : ''}$${p.value.toFixed(2)} (${p.pct >= 0 ? '+' : ''}${p.pct.toFixed(1)}%)`
  );

  const reply =
    `Portfolio\n` +
    `───────────────\n` +
    lines.join('\n') +
    `\n───────────────\n` +
    `Total: $${result.totalValue.toFixed(2)}  (${result.totalPct >= 0 ? '+' : ''}${result.totalPct.toFixed(1)}%)`;

  await responder.send(chatId, reply);
}

module.exports = portfolio;
