import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { type Abi } from 'viem';
import { getContract, CONTRACT_ADDRESSES } from '../config/contracts';
import { useApproveAndExecute } from './useApproveAndExecute';
import { hederaTestnet } from '../config/wagmi';



const CHAIN_ID = 296;

// ─── Read Hooks ──────────────────────────────────────────────

/** Total deposits for a token in the LendingPool */
export function usePoolDeposits(token: `0x${string}` | undefined) {
  const { abi, address } = getContract('lendingPool', CHAIN_ID);
  return useReadContract({
    address: address as `0x${string}`,
    abi: abi as Abi,
    functionName: 'getTotalDeposits',
    args: token ? [token] : undefined,
    query: { enabled: !!token },
  });
}

/** Total borrowed for a token in the LendingPool */
export function usePoolBorrowed(token: `0x${string}` | undefined) {
  const { abi, address } = getContract('lendingPool', CHAIN_ID);
  return useReadContract({
    address: address as `0x${string}`,
    abi: abi as Abi,
    functionName: 'getTotalBorrowed',
    args: token ? [token] : undefined,
    query: { enabled: !!token },
  });
}

/** User's LP shares for a token */
export function useUserShares(token: `0x${string}` | undefined) {
  const { address: user } = useAccount();
  const { abi, address } = getContract('lendingPool', CHAIN_ID);
  return useReadContract({
    address: address as `0x${string}`,
    abi: abi as Abi,
    functionName: 'userShares',
    args: user && token ? [user, token] : undefined,
    query: { enabled: !!user && !!token },
  });
}

// ─── Write Hooks ─────────────────────────────────────────────

/**
 * Deposit token into LendingPool.
 * Two-step: approve token to LendingPool, then deposit(token, amount, receiver).
 */
export function useDeposit(token: `0x${string}` | undefined, amount: bigint) {
  const { address: user } = useAccount();
  const lendingPoolAddress = CONTRACT_ADDRESSES[CHAIN_ID].lendingPool as `0x${string}`;

  return useApproveAndExecute({
    tokenAddress: token ?? ('0x0' as `0x${string}`),
    spender: lendingPoolAddress,
    amount,
    targetContract: 'lendingPool',
    targetFn: 'deposit',
    targetArgs: token && user ? [token, amount, user] : [],
    chainId: CHAIN_ID,
    enabled: !!token && !!user && amount > 0n,
  });
}

/**
 * Withdraw from LendingPool. Burns shares directly — no approve needed.
 */
export function useWithdraw(token: `0x${string}` | undefined, shares: bigint) {
  const { abi, address } = getContract('lendingPool', CHAIN_ID);
  const write = useWriteContract();
  const { address: account } = useAccount();
  
  

  async function withdraw() 
  {
    if (!token) throw new Error('Token address required');
    if (!account) throw new Error('Wallet not connected');

    return write.writeContractAsync({
      address: address as `0x${string}`,
      abi,
      functionName: 'withdraw',
      args: [token, shares] as const,
      account,
      chainId: CHAIN_ID,
    });
  }

  const receipt = useWaitForTransactionReceipt({
    hash: write.data,
    query: { enabled: !!write.data },
  });

  return {
    withdraw,
    isPending: write.isPending,
    error: write.error,
    status: receipt.status,
    hash: write.data,
  };
}
