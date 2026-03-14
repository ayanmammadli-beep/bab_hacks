const responder = require('../responder');
const backend = require('../backend');

/**
 * /deposit <amount>
 * Deposits an amount into the group fund.
 */
async function deposit(args, { chatId, senderHandle }) {
  const rawAmount = args[0];

  if (!rawAmount) {
    return responder.send(chatId, 'Usage: /deposit <amount>\nExample: /deposit 100');
  }

  const amount = parseFloat(rawAmount.replace(/[$,]/g, ''));
  if (isNaN(amount) || amount <= 0) {
    return responder.send(chatId, `Invalid amount: "${rawAmount}". Please provide a positive number.`);
  }

  const result = await backend.deposit({ amount, from: senderHandle, chatId });

  const reply =
    `ka-ching 💰 $${result.amount.toFixed(2)} received.\n` +
    `fund total: $${result.fundTotal.toFixed(2)}\n\n` +
    `your friends better not blow it on memecoins.`;

  await responder.send(chatId, reply);
}

module.exports = deposit;
