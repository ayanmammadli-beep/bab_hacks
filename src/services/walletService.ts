import { Wallet as EthersWallet } from "ethers";
import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { config } from "../config.js";
import { encrypt, decrypt } from "../lib/crypto.js";

const prisma = new PrismaClient();

export async function getOrCreateWallet(groupChatId: string): Promise<{
  id: string;
  address: string;
  groupChatId: string;
  usdcBalance: string;
}> {
  const existing = await prisma.wallet.findUnique({
    where: { groupChatId },
  });
  if (existing) {
    return {
      id: existing.id,
      address: existing.address,
      groupChatId: existing.groupChatId,
      usdcBalance: existing.usdcBalance.toString(),
    };
  }

  const ethersWallet = EthersWallet.createRandom();
  const privateKey = ethersWallet.privateKey;
  const encryptedKey = encrypt(privateKey, config.walletEncryptionKey);

  const created = await prisma.wallet.create({
    data: {
      groupChatId,
      address: ethersWallet.address,
      privateKey: encryptedKey,
    },
  });

  return {
    id: created.id,
    address: created.address,
    groupChatId: created.groupChatId,
    usdcBalance: created.usdcBalance.toString(),
  };
}

export async function getDecryptedPrivateKey(groupChatId: string): Promise<string> {
  const wallet = await prisma.wallet.findUnique({
    where: { groupChatId },
  });
  if (!wallet) throw new Error(`Wallet not found for groupChatId: ${groupChatId}`);
  return decrypt(wallet.privateKey, config.walletEncryptionKey);
}

export async function getWalletAddress(groupChatId: string): Promise<string | null> {
  const w = await prisma.wallet.findUnique({
    where: { groupChatId },
    select: { address: true },
  });
  return w?.address ?? null;
}

export async function getWalletInfo(groupChatId: string): Promise<{
  address: string;
  usdcBalance: string;
} | null> {
  const w = await prisma.wallet.findUnique({
    where: { groupChatId },
    select: { address: true, usdcBalance: true },
  });
  if (!w) return null;
  return { address: w.address, usdcBalance: w.usdcBalance.toString() };
}

export async function fundWallet(groupChatId: string, amount: number): Promise<{ usdcBalance: string }> {
  if (amount <= 0) throw new Error("Fund amount must be positive");
  await getOrCreateWallet(groupChatId);
  const updated = await prisma.wallet.update({
    where: { groupChatId },
    data: { usdcBalance: { increment: new Decimal(amount) } },
    select: { usdcBalance: true },
  });
  return { usdcBalance: updated.usdcBalance.toString() };
}

export async function deductUsdcBalance(groupChatId: string, amount: number): Promise<void> {
  const wallet = await prisma.wallet.findUnique({ where: { groupChatId } });
  if (!wallet) throw new Error(`Wallet not found for groupChatId: ${groupChatId}`);
  const current = Number(wallet.usdcBalance);
  if (current < amount) {
    throw new Error(`Insufficient USDC balance: have ${current}, need ${amount}`);
  }
  await prisma.wallet.update({
    where: { groupChatId },
    data: { usdcBalance: { decrement: new Decimal(amount) } },
  });
}
