const axios = require('axios');

const client = axios.create({
  baseURL: 'https://api.linqapp.com/api/partner',
  headers: { Authorization: `Bearer ${process.env.LINQ_API_TOKEN}` },
});

/**
 * Returns phone numbers of all non-bot participants in a chat.
 */
async function getChatParticipants(chatId) {
  try {
    const res = await client.get(`/v3/chats/${chatId}`);
    const handles = res.data?.chat?.handles ?? [];
    return handles
      .filter((h) => !h.is_me && h.status === 'active')
      .map((h) => h.handle);
  } catch (err) {
    console.error('Failed to fetch chat participants:', err.response?.data ?? err.message);
    return [];
  }
}

module.exports = { getChatParticipants };
