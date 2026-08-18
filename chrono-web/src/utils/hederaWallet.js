import { ethers } from 'ethers';
import { HEDERA_TESTNET_CHAIN_ID, HEDERA_TESTNET_RPC } from './contracts';

let provider = null;

export async function connectWallet() {
  if (!window.ethereum) {
    throw new Error('No crypto wallet found. Please install MetaMask or HashPack.');
  }

  await ensureHederaTestnet();

  await window.ethereum.request({
    method: 'wallet_requestPermissions',
    params: [{ eth_accounts: {} }],
  });

  provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  
  return { signer, address };
}

export async function disconnectWallet() {
  provider = null;
  // EVM wallets do not have a programmatic disconnect
}

export function getSigner() {
  if (!provider) return null;
  return provider.getSigner();
}

export async function ensureHederaTestnet() {
  if (!window.ethereum) return;
  
  const chainIdHex = `0x${HEDERA_TESTNET_CHAIN_ID.toString(16)}`;
  
  try {
    const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
    if (currentChainId !== chainIdHex) {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainIdHex }],
      });
    }
  } catch (error) {
    if (error.code === 4902) {
      // Chain not added, try adding it
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: chainIdHex,
            chainName: 'Hedera Testnet',
            nativeCurrency: {
              name: 'HBAR',
              symbol: 'HBAR',
              decimals: 18,
            },
            rpcUrls: [HEDERA_TESTNET_RPC],
            blockExplorerUrls: ['https://hashscan.io/testnet/'],
          },
        ],
      });
    } else {
      throw error;
    }
  }
}

export function subscribeToAccountChanges(callback) {
  if (!window.ethereum) return () => {};

  const handleAccountsChanged = (accounts) => {
    if (accounts.length > 0) {
      callback(accounts[0]);
    } else {
      callback(null); // disconnected
    }
  };

  const handleChainChanged = () => {
    window.location.reload();
  };

  window.ethereum.on('accountsChanged', handleAccountsChanged);
  window.ethereum.on('chainChanged', handleChainChanged);

  return () => {
    window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
    window.ethereum.removeListener('chainChanged', handleChainChanged);
  };
}
