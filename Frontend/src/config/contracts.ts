import { chronoRouterAbi } from '../abis/ChronoRouterAbi';
import { lendingPoolAbi } from '../abis/LendingPoolAbi';
import { stabilityPoolAbi } from '../abis/StabilityPoolAbi.ts';
import { erc20Abi } from "../abis/erc20Abi";

/**
 * Deployed contract addresses keyed by chain id.
 * Only 296 (Hedera Testnet) populated for MVP.
 * Adding mainnet later = filling in 295, not restructuring.
 */
export const CONTRACT_ADDRESSES = {
  296: {
    chronoRouter: '0xF5fAc5118941130d0eF9f5706835957f5cb64156',
    lendingPool: '0x95343E990D4873977cF25005813D5dea1Af9BD5a',
    stabilityPool: '0xed9C3ba921627B242b6A349612477b0682361cc4',
  },
} as const;

/**
 * Known wrapped testnet tokens from deployments/testnet.json.
 */
export const KNOWN_TOKENS = {
  296: {
    wUSDC: '0x000000000000000000000000000000000098a590' as `0x${string}`,
    wETH: '0x000000000000000000000000000000000098a593' as `0x${string}`,
    wBTC: '0x000000000000000000000000000000000098A597' as `0x${string}`,
  },
} as const;

const ABIS = {
  chronoRouter: chronoRouterAbi,
  lendingPool: lendingPoolAbi,
  stabilityPool: stabilityPoolAbi,
  erc20: erc20Abi,
} as const;

type ContractName = keyof typeof ABIS;

/**
 * Single source for {address, abi} pairs — always pull both from here,
 * never import raw ABI JSON directly in a component.
 */
export function getContract(name: ContractName, chainId: keyof typeof CONTRACT_ADDRESSES = 296) {
  const addresses = CONTRACT_ADDRESSES[chainId];
  if (!addresses) throw new Error(`No Chrono deployment configured for chainId ${chainId}`);

  const address = name === 'erc20'
    ? undefined
    : (addresses as Record<string, string>)[name] as `0x${string}`;

  if (name !== 'erc20' && !address) {
    throw new Error(`No address configured for ${name} on chain ${chainId}`);
  }

  return { address, abi: ABIS[name] } as const;
}
