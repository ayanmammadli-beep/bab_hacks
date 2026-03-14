const crypto = require('crypto');
const router = require('./router');

const SIGNING_SECRET = process.env.LINQ_WEBHOOK_SECRET;

/**
 * Verifies the LINQ webhook signature.
 * Signature = HMAC-SHA256("{timestamp}.{rawBody}")
 */
function verifySignature(rawBody, timestamp, signature) {
  if (!SIGNING_SECRET) return true; // skip in dev if secret not set
  const message = `${timestamp}.${rawBody.toString('utf-8')}`;
  const expected = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(message)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

async function handleWebhook(req, res) {
  const timestamp = req.headers['x-webhook-timestamp'];
  const signature = req.headers['x-webhook-signature'];
  const rawBody = req.body; // raw Buffer (express.raw middleware)

  if (!verifySignature(rawBody, timestamp, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Reject stale webhooks (> 5 minutes old)
  if (timestamp && Date.now() / 1000 - parseInt(timestamp) > 300) {
    return res.status(401).json({ error: 'Stale webhook' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Respond immediately; process async
  res.status(200).json({ received: true });

  if (event.event_type === 'message.received') {
    await router.dispatch(event).catch((err) =>
      console.error('Router error:', err)
    );
  } else if (event.event_type === 'chat.created') {
    await router.dispatchChatCreated(event).catch((err) =>
      console.error('Chat created error:', err)
    );
  } else if (event.event_type === 'reaction.added' || event.event_type === 'reaction.removed') {
    await router.dispatchReaction(event).catch((err) =>
      console.error('Reaction error:', err)
    );
  }
}

module.exports = { handleWebhook };
