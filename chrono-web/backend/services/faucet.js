import { ethers } from 'ethers';
import { config } from '../config/index.js';
import { getWrappedTokenFactory } from '../config/contracts.js';

const rateLimits = new Map();
const RATE_LIMIT_MS = 24 * 60 * 60 * 1000;

export async function mintTokens(walletAddress, asset) {
  const assetMap = {
    'wETH': { address: config.addresses.wETH, amount: 10n * 10n**8n },
    'wUSDC': { address: config.addresses.wUSDC, amount: 10000n * 10n**8n },
    'wBTC': { address: config.addresses.wBTC, amount: 50000000n } // 0.5 * 10^8
  };

  const assetInfo = assetMap[asset];
  if (!assetInfo) {
    throw new Error(`Unsupported asset: ${asset}`);
  }

  const key = `${walletAddress.toLowerCase()}-${asset}`;
  const lastClaim = rateLimits.get(key);
  if (lastClaim && (Date.now() - lastClaim < RATE_LIMIT_MS)) {
    throw new Error(`Rate limit exceeded for ${asset}. Try again in 24 hours.`);
  }

  const provider = new ethers.JsonRpcProvider(config.HEDERA_TESTNET_RPC);
  const wallet = new ethers.Wallet(config.PRIVATE_KEY, provider);
  const factory = getWrappedTokenFactory(wallet);

  const tx = await factory.transferTokens(assetInfo.address, walletAddress, assetInfo.amount);
  const receipt = await tx.wait();

  rateLimits.set(key, Date.now());

  return { success: true, txHash: receipt.hash, message: `Successfully claimed ${asset}` };
}
