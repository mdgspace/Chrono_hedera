import { useAccount } from 'wagmi';
import { CONTRACT_ADDRESSES } from '../config/contracts';
import { useApproveAndExecute } from './useApproveAndExecute';

const CHAIN_ID = 296;

/**
 * Open a borrow position via ChronoRouter.
 * Two-step: approve collateral token to ChronoRouter, then openPosition(...).
 */
export function useOpenPosition({
  collateralToken,
  debtToken,
  collateralAmount,
  borrowAmount,
  durationSeconds,
}: {
  collateralToken: `0x${string}` | undefined;
  debtToken: `0x${string}` | undefined;
  collateralAmount: bigint;
  borrowAmount: bigint;
  durationSeconds: bigint;
}) {
  const { address: user } = useAccount();
  const routerAddress = CONTRACT_ADDRESSES[CHAIN_ID].chronoRouter as `0x${string}`;

  return useApproveAndExecute({
    tokenAddress: collateralToken ?? ('0x0' as `0x${string}`),
    spender: routerAddress,
    amount: collateralAmount,
    targetContract: 'chronoRouter',
    targetFn: 'openPosition',
    targetArgs: collateralToken && debtToken
      ? [collateralToken, debtToken, collateralAmount, borrowAmount, durationSeconds]
      : [],
    chainId: CHAIN_ID,
    enabled: !!collateralToken && !!debtToken && !!user && collateralAmount > 0n && borrowAmount > 0n,
  });
}

/**
 * Repay debt on an existing position via ChronoRouter.
 * Two-step: approve debt token to ChronoRouter, then repay(positionId, amount).
 */
export function useRepay({
  debtToken,
  positionId,
  amount,
}: {
  debtToken: `0x${string}` | undefined;
  positionId: `0x${string}` | undefined;
  amount: bigint;
}) {
  const { address: user } = useAccount();
  const routerAddress = CONTRACT_ADDRESSES[CHAIN_ID].chronoRouter as `0x${string}`;

  return useApproveAndExecute({
    tokenAddress: debtToken ?? ('0x0' as `0x${string}`),
    spender: routerAddress,
    amount,
    targetContract: 'chronoRouter',
    targetFn: 'repay',
    targetArgs: positionId ? [positionId, amount] : [],
    chainId: CHAIN_ID,
    enabled: !!debtToken && !!positionId && !!user && amount > 0n,
  });
}
