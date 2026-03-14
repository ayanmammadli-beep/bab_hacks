import { Wallet as EthersWallet } from "ethers";
import { PrismaClient } from "@prisma/client";
import { config } from "../config.js";
import { encrypt, decrypt } from "../lib/crypto.js";

const prisma = new PrismaClient();

export async function getOrCreateWallet(groupChatId: string): Promise<{
  id: string;
  address: string;
  groupChatId: string;
}> {
  const existing = await prisma.wallet.findUnique({
    where: { groupChatId },
  });
  if (existing) {
    return {
      id: existing.id,
      address: existing.address,
      groupChatId: existing.groupChatId,
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
