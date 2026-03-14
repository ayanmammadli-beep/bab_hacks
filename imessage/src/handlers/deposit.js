const responder = require('../responder');
const backend = require('../backend');
const wallets = require('../wallets');
const { createOnrampUrl } = require('../coinbaseOnramp');

/**
 * /deposit <amount> [voting|trading]
 *
 * voting  → XRPL reserve vault. Increases the user's voting weight.
 * trading → Trading vault. Funds actual trades on Polymarket / Liquid.
 *
 * If vault is not specified, ask the user to clarify.
 */
async function deposit(args, { chatId, senderHandle }) {
  const rawAmount = args[0];
  const vault = args[1]; // 'voting' | 'trading' | ''

  if (!rawAmount) {
    return responder.send(chatId, 'how much do you want to put in? e.g. "deposit 500 into the voting pool" or "deposit 200 into the trading vault"');
  }

  const amount = parseFloat(rawAmount.replace(/[$,]/g, ''));
  if (isNaN(amount) || amount <= 0) {
    return responder.send(chatId, `"${rawAmount}" doesn't look like a number. try again.`);
  }

  if (!vault) {
    return responder.send(
      chatId,
      `which vault?\n\n` +
      `voting vault — deposits here increase your voting power (XRPL reserve)\n` +
      `trading vault — deposits here fund actual trades on Polymarket / Liquid\n\n` +
      `e.g. "deposit ${amount} into the voting pool" or "deposit ${amount} into the trading vault"`
    );
  }

  if (vault === 'voting') {
    // Voting vault = XRPL. Generate a Coinbase Onramp link for XRP.
    const wallet = wallets.getOrCreate(senderHandle);

    let link;
    try {
      link = await createOnrampUrl(wallet.address, amount, senderHandle);
    } catch (err) {
      console.error('[deposit:voting] coinbase onramp error:', err?.response?.data ?? err.message);
      return responder.send(chatId, "couldn't generate a deposit link right now. try again in a moment.");
    }

    await backend.depositToReserve({ amount, from: senderHandle, chatId });

    const reply =
      `voting vault deposit — $${amount} in XRP 👇\n` +
      `${link}\n\n` +
      `once it lands your voting weight goes up.\n` +
      `wallet: ${wallet.address}`;

    return responder.send(chatId, reply);
  }

  if (vault === 'trading') {
    // Trading vault — handled by coworker's service.
    // TODO: generate a deposit link/address from the trading vault API instead.
    await backend.depositToTrading({ amount, from: senderHandle, chatId });

    const reply =
      `trading vault deposit — $${amount} noted.\n\n` +
      `your funds will be available for the next approved trade on Polymarket / Liquid.`;

    return responder.send(chatId, reply);
  }
}

module.exports = deposit;
