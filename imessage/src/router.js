const parser = require('./parser');
const responder = require('./responder');
const handlers = require('./handlers');
const nlp = require('./nlp');
const wallets = require('./wallets');

/**
 * Extracts message text from the LINQ v3 webhook event payload.
 */
function extractText(event) {
  const parts = event?.data?.parts ?? [];
  return parts
    .filter((p) => p.type === 'text')
    .map((p) => p.value)
    .join(' ')
    .trim();
}

/**
 * Dispatches an incoming message.received event to the correct handler.
 */
async function dispatch(event) {
  const chatId = event?.data?.chat?.id;
  const senderHandle = event?.data?.sender_handle?.handle ?? 'unknown';
  const text = extractText(event);

  // Provision wallet on first message from this number
  if (senderHandle !== 'unknown') wallets.getOrCreate(senderHandle);

  console.log(`[${chatId}] ${senderHandle}: ${text}`);

  // Try slash command parser first; fall back to NLP for plain English
  let parsed = parser.parse(text);
  if (!parsed) {
    // Only invoke NLP if the message is clearly addressed to TARS
    if (!/\btars\b/i.test(text)) return;
    parsed = await nlp.interpret(text, senderHandle);
  }
  if (!parsed) return;

  const context = { chatId, senderHandle, event };

  switch (parsed.command) {
    case '/createfund':
      return handlers.createFund(parsed.args, context);
    case '/deposit':
      return handlers.deposit(parsed.args, context);
    case '/propose_trade':
      return handlers.proposeTrade(parsed.args, context);
    case '/vote':
      return handlers.vote(parsed.args, context);
    case '/portfolio':
      return handlers.portfolio(parsed.args, context);
    case '/my_wallet':
      return handlers.myWallet(parsed.args, context);
    case '/unknown':
      return responder.send(chatId, unknownCommandMessage(parsed.raw));
    case '/ignore':
      if (parsed.reply) return responder.send(chatId, parsed.reply);
      return;
    default:
      break;
  }
}

function unknownCommandMessage(raw) {
  return (
    `Unknown command: ${raw}\n\n` +
    `Available commands:\n` +
    `/createfund [name]\n` +
    `/deposit <amount>\n` +
    `/propose_trade <description>\n` +
    `/vote yes|no\n` +
    `/portfolio`
  );
}

async function dispatchChatCreated(event) {
  const chatId = event?.data?.chat?.id ?? event?.data?.chat_id;
  if (!chatId) return;
  console.log(`[chat.created] ${chatId}`);
  await handlers.chatCreated({ chatId });
}

async function dispatchReaction(event) {
  const messageId = event?.data?.message_id ?? event?.data?.id;
  const voter = event?.data?.sender_handle?.handle ?? event?.data?.handle?.handle ?? 'unknown';
  const reactionType = event?.data?.reaction_type ?? event?.data?.type;
  const isRemoved = event.event_type === 'reaction.removed';

  if (!messageId || !reactionType) return;

  console.log(`[${event.event_type}] message=${messageId} voter=${voter} type=${reactionType}`);

  if (isRemoved) {
    await handlers.reaction.reactionRemoved({ messageId, voter });
  } else {
    await handlers.reaction.reactionAdded({ messageId, voter, reactionType });
  }
}

module.exports = { dispatch, dispatchChatCreated, dispatchReaction };
