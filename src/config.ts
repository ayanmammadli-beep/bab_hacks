function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) throw new Error(`Missing env: ${key}`);
  return value;
}

export const config = {
  port: parseInt(getEnv("PORT", "3000"), 10),
  databaseUrl: getEnv("DATABASE_URL"),
  walletEncryptionKey: getEnv("WALLET_ENCRYPTION_KEY"),
  polymarket: {
    clobHost: getEnv("POLYMARKET_CLOB_HOST", "https://clob.polymarket.com"),
    gammaHost: getEnv("POLYMARKET_GAMMA_HOST", "https://gamma-api.polymarket.com"),
    chainId: parseInt(getEnv("POLYGON_CHAIN_ID", "137"), 10),
  },
  voting: {
    defaultApprovalWeight: parseFloat(getEnv("DEFAULT_APPROVAL_WEIGHT", "0.6")),
  },
  predictionMarket: {
    /** Approval threshold (0–1) to create a market from a proposal. */
    approvalThreshold: parseFloat(getEnv("PREDICTION_APPROVAL_THRESHOLD", "0.6")),
    /** Resolution threshold (0–1) to resolve immediately when one side reaches it during 24h window. */
    resolutionThreshold: parseFloat(getEnv("PREDICTION_RESOLUTION_THRESHOLD", "0.6")),
    /** Hours after event deadline before resolution window closes (then resolve by majority). */
    resolutionWindowHours: parseInt(getEnv("PREDICTION_RESOLUTION_WINDOW_HOURS", "24"), 10),
  },
} as const;
