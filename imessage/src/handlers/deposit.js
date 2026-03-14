const responder = require('../responder');
const backend = require('../backend');
const wallets = require('../wallets');
const { createOnrampUrl } = require('../coinbaseOnramp');

/**
 * /deposit <amount>
 * Generates a Coinbase Onramp link pre-filled with the requested USD amount,
 * pointed at the user's personal XRP wallet address.
 */
async function deposit(args, { chatId, senderHandle }) {
  const rawAmount = args[0];

  if (!rawAmount) {
    return responder.send(chatId, 'how much do you want to put in? e.g. "TARS deposit 100"');
  }

  const amount = parseFloat(rawAmount.replace(/[$,]/g, ''));
  if (isNaN(amount) || amount <= 0) {
    return responder.send(chatId, `"${rawAmount}" doesn't look like a number. try again.`);
  }

  const wallet = wallets.getOrCreate(senderHandle);

  let link;
  try {
    link = await createOnrampUrl(wallet.address, amount, senderHandle);
  } catch (err) {
    console.error('[deposit] coinbase onramp error:', err?.response?.data ?? err.message);
    return responder.send(chatId, 'couldn\'t generate a deposit link right now. try again in a moment.');
  }

  await backend.deposit({ amount, from: senderHandle, chatId });

  const reply =
    `here's your $${amount} deposit link 👇\n` +
    `${link}\n\n` +
    `pay with card, Apple Pay, ACH, or your Coinbase account.\n` +
    `XRP will land directly in your wallet:\n${wallet.address}`;

  await responder.send(chatId, reply);
}

module.exports = deposit;
