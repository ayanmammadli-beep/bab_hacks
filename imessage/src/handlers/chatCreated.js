const responder = require('../responder');

/**
 * chat.created
 * Fires when a new group chat is started.
 */
async function chatCreated({ chatId }) {
  const welcome =
    `yo. TARS is in the chat. 👋\n\n` +
    `your group hedge fund starts now. here's how it works:\n\n` +
    `just text naturally or use commands:\n` +
    `• "create a fund called Alpha Boys"\n` +
    `• "I'm putting in $200"\n` +
    `• "let's bet on ETH hitting 5k"\n` +
    `• "I'm down" / "nah too risky" (to vote)\n` +
    `• "how's our portfolio?"\n\n` +
    `say "TARS send me my wallet" to get your deposit link 🏦`;

  await responder.send(chatId, welcome);
}

module.exports = chatCreated;
