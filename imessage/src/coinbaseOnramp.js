const { generateJwt } = require('@coinbase/cdp-sdk/auth');
const axios = require('axios');

const API_BASE = 'https://api.cdp.coinbase.com';

/**
 * Generates a signed JWT for CDP API requests.
 */
async function makeJwt(method, path) {
  return generateJwt({
    apiKeyId: process.env.CDP_API_KEY_ID,
    apiKeySecret: process.env.CDP_API_KEY_SECRET,
    requestMethod: method,
    requestHost: 'api.cdp.coinbase.com',
    requestPath: path,
  });
}

/**
 * Creates a Coinbase Onramp session and returns a single-use URL.
 *
 * @param {string} destinationAddress - User's XRP wallet address
 * @param {number|string} paymentAmount - Fiat amount (USD) the user wants to spend
 * @param {string} [partnerUserRef] - Unique ID for the user (phone number)
 * @returns {Promise<string>} Single-use onramp URL
 */
async function createOnrampUrl(destinationAddress, paymentAmount, partnerUserRef) {
  const path = '/platform/v2/onramp/sessions';
  const jwt = await makeJwt('POST', path);

  const body = {
    purchaseCurrency: 'XRP',
    destinationNetwork: 'ripple',
    destinationAddress,
    defaultExperience: 'buy',
  };

  if (paymentAmount != null) {
    body.paymentAmount = String(Number(paymentAmount).toFixed(2));
    body.paymentCurrency = 'USD';
  }

  if (partnerUserRef) body.partnerUserRef = String(partnerUserRef).slice(0, 49);

  const { data } = await axios.post(`${API_BASE}${path}`, body, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
  });

  return data.session.onrampUrl;
}

module.exports = { createOnrampUrl };
