import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { type Abi } from 'viem';
import { getContract, CONTRACT_ADDRESSES } from '../config/contracts';
import { useApproveAndExecute } from './useApproveAndExecute';
import { hederaTestnet } from '../config/wagmi';
const CHAIN_ID = 296;

// ─── Read Hooks ──────────────────────────────────────────────

/** Total scaled deposits for a debt token in the StabilityPool */
export function useTotalScaledDeposits(debtToken: `0x${string}` | undefined) {
  const { abi, address } = getContract('stabilityPool', CHAIN_ID);
  return useReadContract({
    address: address as `0x${string}`,
    abi: abi as Abi,
    functionName: 'totalScaledDeposits',
    args: debtToken ? [debtToken] : undefined,
    query: { enabled: !!debtToken },
  });
}

/** Provider's scaled deposits for a debt token */
export function useProviderDeposits(debtToken: `0x${string}` | undefined) {
  const { address: provider } = useAccount();
  const { abi, address } = getContract('stabilityPool', CHAIN_ID);
  return useReadContract({
    address: address as `0x${string}`,
    abi: abi as Abi,
    functionName: 'providerScaledDeposits',
    args: provider && debtToken ? [provider, debtToken] : undefined,
    query: { enabled: !!provider && !!debtToken },
  });
}

// ─── Write Hooks ─────────────────────────────────────────────

/**
 * Deposit debt token into StabilityPool.
 * Two-step: approve token to StabilityPool, then deposit(debtToken, amount).
 */
export function useProvideToSP(debtToken: `0x${string}` | undefined, amount: bigint) {
  const { address: user } = useAccount();
  const stabilityPoolAddress = CONTRACT_ADDRESSES[CHAIN_ID].stabilityPool as `0x${string}`;

  return useApproveAndExecute({
    tokenAddress: debtToken ?? ('0x0' as `0x${string}`),
    spender: stabilityPoolAddress,
    amount,
    targetContract: 'stabilityPool',
    targetFn: 'deposit',
    targetArgs: debtToken ? [debtToken, amount] : [],
    chainId: CHAIN_ID,
    enabled: !!debtToken && !!user && amount > 0n,
  });
}

/**
 * Withdraw from StabilityPool. No approve needed.
 */
export function useWithdrawFromSP(debtToken: `0x${string}` | undefined, amount: bigint) {
  const { abi, address } = getContract('stabilityPool', CHAIN_ID);
  const { address: account } = useAccount();
  const write = useWriteContract();

  async function withdraw() {
    if (!debtToken) throw new Error('Debt token address required');
    if (!account) throw new Error('Wallet not connected');
    return write.writeContractAsync({
      address: address as `0x${string}`,
      abi,
      functionName: 'withdraw',
      args: [debtToken, amount],
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

/**
 * Claim collateral rewards from liquidation proceeds.
 */
export function useClaimRewards(debtToken: `0x${string}` | undefined) {
  const { abi, address } = getContract('stabilityPool', CHAIN_ID);
  const { address: account } = useAccount();
  const write = useWriteContract();

  async function claim() {
    if (!debtToken) throw new Error('Debt token address required');
    if (!account) throw new Error('Wallet not connected');
    return write.writeContractAsync({
      address: address as `0x${string}`,
      abi,
      functionName: 'claimCollateralRewards',
      args: [debtToken],
      account,
      chainId: CHAIN_ID,
      chain: hederaTestnet,
    });
  }

  const receipt = useWaitForTransactionReceipt({
    hash: write.data,
    query: { enabled: !!write.data },
  });

  return {
    claim,
    isPending: write.isPending,
    error: write.error,
    status: receipt.status,
    hash: write.data,
  };
}
