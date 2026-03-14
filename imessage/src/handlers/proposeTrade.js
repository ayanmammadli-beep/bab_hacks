const responder = require('../responder');
const backend = require('../backend');

/**
 * /propose_trade <description>
 * Proposes a trade for the group to vote on.
 *
 * Example: /propose_trade Buy $500 YES ETH > $4000 Dec 2026
 */
async function proposeTrade(args, { chatId, senderHandle }) {
  if (args.length === 0) {
    return responder.send(
      chatId,
      'Usage: /propose_trade <description>\nExample: /propose_trade Buy $500 YES ETH > $4000 Dec 2026'
    );
  }

  const description = args.join(' ');
  const result = await backend.proposeTrade({ description, proposedBy: senderHandle, chatId });

  const reply =
    `ooh someone's feeling bold 👀\n\n` +
    `"${result.description}"\n\n` +
    `the group decides. react 👍 to send it or 👎 to kill it.\n` +
    `or type /vote yes / /vote no`;

  const messageId = await responder.send(chatId, reply);
  if (messageId) {
    await backend.setProposalMessageId({ chatId, messageId });
  }
}

module.exports = proposeTrade;
