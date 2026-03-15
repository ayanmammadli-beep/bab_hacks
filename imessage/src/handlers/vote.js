const responder = require('../responder');
const backend = require('../backend');

/**
 * /vote yes|no
 * Votes on the active trade proposal.
 */
async function vote(args, { chatId, senderHandle }) {
  const choice = args[0]?.toLowerCase();

  if (choice !== 'yes' && choice !== 'no') {
    return responder.send(chatId, 'Usage: /vote yes  or  /vote no');
  }

  let result;
  try {
    result = await backend.vote({ choice, voter: senderHandle, chatId });
  } catch (err) {
    const msg = err?.response?.data?.error ?? err.message;
    return responder.send(chatId, `vote failed: ${msg}`);
  }

  if (result.error) {
    return responder.send(chatId, result.error);
  }

  const yesPct = Math.round((result.yesWeight ?? 0) * 100);
  const noPct  = Math.round((result.noWeight  ?? 0) * 100);
  const statusLine = result.passed
    ? `it's a yes. executing trade. no ragrets. 🚀`
    : result.failed
    ? `proposal killed. the group has spoken. rip. 🪦`
    : `${yesPct}% yes so far. still voting...`;

  const voteEmoji = choice === 'yes' ? '✅' : '❌';
  const reply =
    `${voteEmoji} vote locked in.\n` +
    `👍 ${yesPct}%  👎 ${noPct}%\n\n` +
    statusLine;

  await responder.send(chatId, reply);
}

module.exports = vote;
