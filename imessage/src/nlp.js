const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Tool definitions — one per supported command.
 * Claude picks whichever tool matches the user's intent.
 */
const COMMAND_TOOLS = [
  {
    name: 'createfund',
    description: 'User wants to create a new group investment fund. Use when they say things like "let\'s start a fund", "create our fund", "set up a fund", "start investing together".',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name for the fund. Infer from the message or use "My Fund" if not specified.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'deposit',
    description: 'User wants to deposit money into one of the two fund vaults. Use when they mention putting in money, adding funds, depositing, contributing an amount. There are two vaults: the VOTING vault (XRPL reserve vault — deposits here give more voting power/weight) and the TRADING vault (used for actual trades on Polymarket/Liquid). Detect which vault they want from context. Examples: "deposit 500 into the voting pool", "i want more voting power", "fade you lemme put 500 in the vote vault" → vault: voting. "add 200 to the trading fund", "put money in for trades", "top up the trading pool" → vault: trading. If unclear which vault they want, set vault to null.',
    input_schema: {
      type: 'object',
      properties: {
        amount: {
          type: 'number',
          description: 'Amount to deposit. Extract the number from the message.',
        },
        vault: {
          type: 'string',
          enum: ['voting', 'trading'],
          description: '"voting" for the XRPL reserve vault (increases voting power), "trading" for the trading vault (funds actual trades). Infer from message context.',
        },
      },
      required: ['amount'],
    },
  },
  {
    name: 'propose_trade',
    description: 'User wants to propose a trade for the group to vote on. Use when they suggest buying/selling something, mention a prediction market bet, or propose an investment. Classify as "polymarket" for prediction market bets (election outcomes, sports, events) or "liquid" for crypto derivatives (BTC, ETH, perpetuals, leverage trading).',
    input_schema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Full human-readable description of the trade, e.g. "Trump wins 2024 election" or "Long BTC-PERP".',
        },
        type: {
          type: 'string',
          enum: ['polymarket', 'liquid'],
          description: '"polymarket" for prediction market bets on real-world events. "liquid" for crypto perpetuals/derivatives.',
        },
        market: {
          type: 'string',
          description: 'For polymarket: a short search query to find the market, e.g. "trump wins election". For liquid: the trading symbol, e.g. "BTC-PERP".',
        },
        side: {
          type: 'string',
          enum: ['yes', 'no', 'long', 'short'],
          description: 'For polymarket: "yes" or "no". For liquid: "long" or "short".',
        },
        amount: {
          type: 'number',
          description: 'Dollar amount to trade. Extract from the message.',
        },
      },
      required: ['description', 'type', 'market', 'side', 'amount'],
    },
  },
  {
    name: 'vote',
    description: 'User wants to vote yes or no on the active trade proposal. Use when they express agreement/disagreement with a trade, say yes/no, thumbs up/down, or approve/reject.',
    input_schema: {
      type: 'object',
      properties: {
        choice: {
          type: 'string',
          enum: ['yes', 'no'],
          description: '"yes" if they support the trade, "no" if they oppose it.',
        },
      },
      required: ['choice'],
    },
  },
  {
    name: 'portfolio',
    description: 'User wants to see the current portfolio or fund holdings. Use when they ask about positions, performance, what the fund owns, how investments are doing, balance.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'my_wallet',
    description: 'User wants to see their own XRP wallet address or deposit/top-up link. Use when they say things like "send me my wallet", "what\'s my address", "how do I deposit", "give me my link".',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'voter_allocation',
    description: 'User wants to see who has how much voting power, each member\'s share of the voting vault, or how votes are weighted. Use when they ask things like "who has the most votes", "what\'s everyone\'s voting share", "what\'s the voter allocation", "how much voting power does X have", "show me the voting breakdown".',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'ignore',
    description: 'The message is casual conversation, a question not related to the fund, or something the bot cannot help with. Use this when none of the other commands apply.',
    input_schema: {
      type: 'object',
      properties: {
        reply: {
          type: 'string',
          description: 'A short, friendly reply to send back if appropriate. Leave empty string if no reply is needed.',
        },
      },
      required: ['reply'],
    },
  },
];

const SYSTEM_PROMPT = `You are TARS, an iMessage bot that helps friend groups manage a shared crypto investment fund.

Your job is to understand what a group member wants and call the right command tool.

Fund commands available:
- createfund: Start a new group fund
- deposit: Put money into one of two vaults — the VOTING vault (XRPL, gives voting power) or the TRADING vault (funds actual trades)
- propose_trade: Suggest a trade — either a Polymarket prediction bet (elections, sports, events) or a Liquid crypto derivatives trade (BTC/ETH perpetuals)
- vote: Vote yes or no on the current proposal
- portfolio: Check fund holdings and performance

People will text in plain English — not slash commands. Understand their intent and call the matching tool.
If the message isn't related to any fund action, call the "ignore" tool.`;

/**
 * Interprets a natural language message and returns a parsed command.
 *
 * @param {string} text - Raw message text
 * @param {string} senderHandle - Phone number of the sender
 * @returns {{ command: string, args: string[] } | null}
 */
async function interpret(text, senderHandle) {
  let response;
  try {
    response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: COMMAND_TOOLS,
      tool_choice: { type: 'any' }, // always call a tool
      messages: [
        {
          role: 'user',
          content: `Message from ${senderHandle}: "${text}"`,
        },
      ],
    });
  } catch (err) {
    console.error('NLP error:', err.message);
    return null;
  }

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse) return null;

  const { name, input } = toolUse;

  switch (name) {
    case 'createfund':
      return { command: '/createfund', args: input.name ? [input.name] : [] };
    case 'deposit':
      return { command: '/deposit', args: [String(input.amount), input.vault ?? ''] };
    case 'propose_trade':
      return {
        command: '/propose_trade',
        args: [],
        data: {
          description: input.description,
          type: input.type,
          market: input.market,
          side: input.side,
          amount: input.amount,
        },
      };
    case 'vote':
      return { command: '/vote', args: [input.choice] };
    case 'portfolio':
      return { command: '/portfolio', args: [] };
    case 'my_wallet':
      return { command: '/my_wallet', args: [] };
    case 'voter_allocation':
      return { command: '/voter_allocation', args: [] };
    case 'ignore':
      // Return a special marker so the router can send a reply if needed
      return { command: '/ignore', args: [], reply: input.reply ?? '' };
    default:
      return null;
  }
}

module.exports = { interpret };
