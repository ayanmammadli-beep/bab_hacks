/**
 * Parses a raw message text into a structured command object.
 *
 * Returns:
 *   { command: string, args: string[], raw: string }
 *   or null if the message is not a command.
 *
 * Supported commands:
 *   /createfund [name]
 *   /deposit <amount>
 *   /propose_trade <description>
 *   /vote yes|no
 *   /portfolio
 */
function parse(text) {
  if (!text || !text.startsWith('/')) return null;

  const trimmed = text.trim();
  const spaceIndex = trimmed.indexOf(' ');
  const commandRaw = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
  const rest = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1).trim();

  const command = commandRaw.toLowerCase();
  const args = rest.length > 0 ? rest.split(/\s+/) : [];

  const supported = [
    '/createfund',
    '/deposit',
    '/propose_trade',
    '/vote',
    '/portfolio',
  ];

  if (!supported.includes(command)) {
    return { command: '/unknown', args: [], raw: trimmed };
  }

  return { command, args, raw: trimmed };
}

module.exports = { parse };
