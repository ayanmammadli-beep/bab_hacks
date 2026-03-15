const responder = require('../responder');
const backend = require('../backend');

/**
 * /voter_allocation
 * Shows each member's share of the voting vault (XRP deposited vs total).
 */
async function voterAllocation(_args, { chatId }) {
  let allocation;
  try {
    allocation = await backend.getVoterAllocation({ chatId });
  } catch (err) {
    const msg = err?.response?.data?.error ?? err.message;
    return responder.send(chatId, `couldn't fetch voter allocation: ${msg}`);
  }

  if (!allocation || allocation.members.length === 0) {
    return responder.send(
      chatId,
      'no one has deposited into the voting vault yet.\n\ndeposit XRP to get voting power: "tars deposit 100 into the voting vault"'
    );
  }

  const lines = allocation.members
    .sort((a, b) => b.sharePercent - a.sharePercent)
    .map((m) => {
      const bar = '█'.repeat(Math.round(m.sharePercent / 5)).padEnd(20, '░');
      return `${m.handle}\n  ${bar} ${m.sharePercent.toFixed(1)}%  (${m.deposited.toFixed(2)} XRP)`;
    });

  const reply =
    `Voting Vault Allocation\n` +
    `────────────────────────\n` +
    lines.join('\n') +
    `\n────────────────────────\n` +
    `Total: ${allocation.totalDeposited.toFixed(2)} XRP`;

  await responder.send(chatId, reply);
}

module.exports = voterAllocation;
