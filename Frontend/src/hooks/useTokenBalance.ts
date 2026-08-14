import { useAccount, useReadContract } from 'wagmi';
import { type Abi } from 'viem';
import { getContract } from '../config/contracts';

/**
 * Read ERC20 balance + decimals for any token address.
 * Returns raw bigint balance and parsed decimals.
 */
export function useTokenBalance(tokenAddress: `0x${string}` | undefined) {
  const { address: owner } = useAccount();
  const erc20 = getContract('erc20', 296);

  const { data: balance, refetch: refetchBalance, isLoading: balanceLoading } = useReadContract({
    address: tokenAddress,
    abi: erc20.abi as Abi,
    functionName: 'balanceOf',
    args: owner ? [owner] : undefined,
    query: { enabled: !!owner && !!tokenAddress },
  });

  const { data: decimals } = useReadContract({
    address: tokenAddress,
    abi: erc20.abi as Abi,
    functionName: 'decimals',
    query: { enabled: !!tokenAddress },
  });

  const { data: symbol } = useReadContract({
    address: tokenAddress,
    abi: erc20.abi as Abi,
    functionName: 'symbol',
    query: { enabled: !!tokenAddress },
  });

  return {
    balance: balance as bigint | undefined,
    decimals: decimals as number | undefined,
    symbol: symbol as string | undefined,
    isLoading: balanceLoading,
    refetch: refetchBalance,
  };
}
