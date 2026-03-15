const responder = require('../responder');
const backend = require('../backend');

/**
 * /propose_trade
 *
 * Structured data (from NLP) expected in context.data:
 *   { description, type: 'polymarket'|'liquid', market, side, amount }
 */
async function proposeTrade(args, { chatId, senderHandle, data }) {
  const { description, type, market, side, amount } = data;

  if (!description || !type || !market || !side || !amount) {
    return responder.send(
      chatId,
      'what do you want to trade?\n\n' +
      'prediction market: "bet 50 on Trump winning the election"\n' +
      'crypto derivatives: "long 100 on BTC-PERP"'
    );
  }

  let proposal;
  try {
    proposal = await backend.proposeTrade({
      chatId,
      proposedBy: senderHandle,
      type,
      description,
      market,
      side,
      amount,
    });
  } catch (err) {
    const msg = err?.response?.data?.error ?? err.message;
    return responder.send(chatId, `couldn't create proposal: ${msg}`);
  }

  const venue = type === 'polymarket' ? 'Polymarket' : 'Liquid';
  const sideLabel = side === 'yes' || side === 'long' ? '🟢' : '🔴';

  const reply =
    `${sideLabel} new proposal\n\n` +
    `"${description}"\n` +
    `$${amount} on ${side.toUpperCase()} via ${venue}\n\n` +
    `react 👍 to approve or 👎 to reject.\n` +
    `or type /vote yes / /vote no`;

  const messageId = await responder.send(chatId, reply);
  if (messageId) await backend.setProposalMessageId({ chatId, messageId });
}

module.exports = proposeTrade;
