const responder = require('../responder');
const backend = require('../backend');

// Reaction type → vote mapping
// like (👍) and love (❤️) = YES
// dislike (👎) = NO
// all others are ignored
const REACTION_MAP = {
  like: 'yes',
  love: 'yes',
  dislike: 'no',
};

async function reactionAdded({ messageId, voter, reactionType }) {
  const choice = REACTION_MAP[reactionType];
  if (!choice) return; // ignore laugh, emphasize, question, etc.

  const result = await backend.voteByReaction({ messageId, voter, reactionType: choice });
  if (!result) return; // not a proposal message

  const { chatId, error, yesVotes, noVotes, totalVotes, passed, failed } = result;

  if (error) {
    return responder.send(chatId, error);
  }

  const supportPct = totalVotes > 0 ? Math.round((yesVotes / totalVotes) * 100) : 0;
  const statusLine = passed
    ? 'Threshold reached — trade executing.'
    : failed
    ? 'Proposal rejected.'
    : `Current support: ${supportPct}%`;

  await responder.send(
    chatId,
    `Vote recorded (${choice.toUpperCase()}) from ${voter}.\n` +
    `👍 ${yesVotes}  👎 ${noVotes}  Total: ${totalVotes}\n` +
    statusLine
  );
}

async function reactionRemoved({ messageId, voter }) {
  const result = await backend.retractVoteByReaction({ messageId, voter });
  if (!result) return; // not a proposal message

  const { chatId, yesVotes, noVotes, totalVotes } = result;
  const supportPct = totalVotes > 0 ? Math.round((yesVotes / totalVotes) * 100) : 0;

  await responder.send(
    chatId,
    `Vote retracted by ${voter}.\n` +
    `👍 ${yesVotes}  👎 ${noVotes}  Total: ${totalVotes}` +
    (totalVotes > 0 ? `\nCurrent support: ${supportPct}%` : '')
  );
}

module.exports = { reactionAdded, reactionRemoved };
