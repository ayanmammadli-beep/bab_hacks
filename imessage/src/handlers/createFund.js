const responder = require('../responder');
const backend = require('../backend');

/**
 * /createfund [name]
 * Creates a new group fund.
 */
async function createFund(args, { chatId, senderHandle }) {
  const fundName = args.length > 0 ? args.join(' ') : 'My Fund';

  const result = await backend.createFund({ name: fundName, createdBy: senderHandle, chatId });

  const reply =
    `hedge fund unlocked. welcome to wall street (but make it group chat).\n\n` +
    `fund: ${result.name}\n` +
    `id: ${result.id}\n\n` +
    `drop your cash with /deposit and let's get this bread 🍞`;

  await responder.send(chatId, reply);
}

module.exports = createFund;
