import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { metaMaskWallet, braveWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import { defineChain } from 'viem';

export const hederaTestnet = defineChain({
  id: 296,
  name: 'Hedera Testnet',
  nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet.hashio.io/api'] },
  },
  blockExplorers: {
    default: { name: 'HashScan', url: 'https://hashscan.io/testnet' },
  },
});

export const wagmiConfig = getDefaultConfig({
  appName: 'Chrono Protocol',
  projectId: 'a40d51ef8adadfc3a0bcf608c02a764d',
  chains: [hederaTestnet],
  wallets: [
    {
      groupName: 'Recommended',
      wallets: [metaMaskWallet, braveWallet, walletConnectWallet],
    },
  ],
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
