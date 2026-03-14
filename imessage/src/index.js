require('dotenv').config();
const express = require('express');
const listener = require('./listener');

const app = express();
const PORT = process.env.PORT || 3000;

// Raw body needed for webhook signature verification
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

app.post('/webhook', listener.handleWebhook);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`LINQ iMessage bot listening on port ${PORT}`);
});
