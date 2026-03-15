const responder = require('../responder');
const backend = require('../backend');
const wallets = require('../wallets');

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
    const wallet = wallets.getOrCreate(senderHandle);
    backend.depositToReserve({ amount, from: senderHandle, chatId }).catch(() => {});

    return responder.send(
      chatId,
      `got it. $${amount} added to the voting vault.\n\n` +
      `your voting weight has been updated. deposit more anytime to increase your share.\n` +
      `wallet: ${wallet.address}`
    );
  }

  if (vault === 'trading') {
    backend.depositToTrading({ amount, from: senderHandle, chatId }).catch(() => {});

    return responder.send(
      chatId,
      `got it. $${amount} added to the trading vault.\n\n` +
      `funds are available for the next approved trade on Polymarket / Liquid.`
    );
  }
}

module.exports = deposit;
