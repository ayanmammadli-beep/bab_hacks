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

  const result = await backend.vote({ choice, voter: senderHandle, chatId });

  if (result.error) {
    return responder.send(chatId, result.error);
  }

  const supportPct = Math.round((result.yesVotes / result.totalVotes) * 100);
  const statusLine = result.passed
    ? `it's a yes. executing trade. no ragrets. 🚀`
    : result.failed
    ? `proposal killed. the group has spoken. rip. 🪦`
    : `${supportPct}% support so far. still voting...`;

  const voteEmoji = choice === 'yes' ? '✅' : '❌';
  const reply =
    `${voteEmoji} vote locked in.\n` +
    `👍 ${result.yesVotes}  👎 ${result.noVotes}\n\n` +
    statusLine;

  await responder.send(chatId, reply);
}

module.exports = vote;
