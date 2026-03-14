const axios = require('axios');

const BASE_URL = 'https://api.linqapp.com/api/partner';
const TOKEN = process.env.LINQ_API_TOKEN;

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
});

// ~60ms per word, clamped between 1s and 5s
function typingDelay(text) {
  const words = text.trim().split(/\s+/).length;
  return Math.min(Math.max(words * 60, 1000), 5000);
}

/**
 * Sends a text message to an existing chat, preceded by a typing indicator.
 * @returns {string|null} The sent message ID, or null on failure.
 */
async function send(chatId, text) {
  try {
    // Start typing indicator (fire-and-forget, ignore errors)
    client.post(`/v3/chats/${chatId}/typing`).catch(() => {});

    await new Promise((r) => setTimeout(r, typingDelay(text)));

    const res = await client.post(`/v3/chats/${chatId}/messages`, {
      message: {
        parts: [{ type: 'text', value: text }],
      },
    });
    return res.data?.message?.id ?? null;
  } catch (err) {
    console.error(
      `Failed to send message to ${chatId}:`,
      err.response?.data ?? err.message
    );
    return null;
  }
}

module.exports = { send };
