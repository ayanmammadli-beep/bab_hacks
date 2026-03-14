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
} as const;
