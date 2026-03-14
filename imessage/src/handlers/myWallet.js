const responder = require('../responder');
const wallets = require('../wallets');
const { createOnrampUrl } = require('../coinbaseOnramp');

/**
 * Sends the caller their XRP wallet address and a Coinbase Onramp top-up link.
 */
async function myWallet(_args, { chatId, senderHandle }) {
  const wallet = wallets.getOrCreate(senderHandle);

  let link;
  try {
    // No amount pre-filled — user picks how much on the Coinbase page
    link = await createOnrampUrl(wallet.address, null, senderHandle);
  } catch (err) {
    console.error('[myWallet] coinbase onramp error:', err?.response?.data ?? err.message);
    link = null;
  }

  const reply = link
    ? `your XRP wallet\n${wallet.address}\n\nadd funds:\n${link}`
    : `your XRP wallet\n${wallet.address}`;

  await responder.send(chatId, reply);
}

module.exports = myWallet;
