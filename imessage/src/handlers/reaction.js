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
  if (!voter || voter === 'unknown') return; // LINQ doesn't include sender in reaction events

  const result = await backend.voteByReaction({ messageId, voter, reactionType: choice });
  if (!result) return; // not a proposal message

  const { chatId, error, yesWeight, noWeight, passed, failed } = result;

  if (error) {
    return responder.send(chatId, error);
  }

  const yesPct = Math.round((yesWeight ?? 0) * 100);
  const noPct  = Math.round((noWeight  ?? 0) * 100);
  const statusLine = passed
    ? 'Threshold reached — trade executing.'
    : failed
    ? 'Proposal rejected.'
    : `Current support: ${yesPct}% yes`;

  await responder.send(
    chatId,
    `Vote recorded (${choice.toUpperCase()}) from ${voter}.\n` +
    `👍 ${yesPct}%  👎 ${noPct}%\n` +
    statusLine
  );
}

async function reactionRemoved({ messageId, voter }) {
  const result = await backend.retractVoteByReaction({ messageId, voter });
  if (!result) return; // not a proposal message or no-op

  const { chatId } = result;
  if (chatId) {
    await responder.send(chatId, `Vote retracted by ${voter}. (XRPL votes are final — no change recorded.)`);
  }
}

module.exports = { reactionAdded, reactionRemoved };
