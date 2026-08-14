import {
  useAccount,
  useReadContract,
  useWriteContract,
  useSimulateContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { type Abi } from 'viem';
import { getContract } from '../config/contracts';
// import { hederaTestnet } from '../config/wagmi';

type TargetContractName = 'chronoRouter' | 'lendingPool' | 'stabilityPool';

interface UseApproveAndExecuteParams {
  tokenAddress: `0x${string}`;
  spender: `0x${string}`;
  amount: bigint;
  targetContract: TargetContractName;
  targetFn: string;
  targetArgs: readonly unknown[];
  chainId?: 296;
  enabled?: boolean;
}

/**
 * Canonical two-step approve-then-execute flow.
 *
 * 1. Check allowance
 * 2. If insufficient, approve
 * 3. Simulate target write (surfaces revert reasons before wallet popup)
 * 4. Execute target write
 *
 * UI-agnostic — no toasts. That layer comes from tx-status-ux skill.
 */
export function useApproveAndExecute({
  tokenAddress,
  spender,
  amount,
  targetContract,
  targetFn,
  targetArgs,
  chainId = 296,
  enabled = true,
}: UseApproveAndExecuteParams) {
  const { address: owner } = useAccount();
  const erc20 = getContract('erc20', chainId);
  const target = getContract(targetContract, chainId);

  // 1. Check current allowance
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: tokenAddress,
    abi: erc20.abi as Abi,
    functionName: 'allowance',
    args: owner ? [owner, spender] : undefined,
    query: { enabled: !!owner && enabled },
  });

  const needsApproval = typeof allowance === 'bigint' ? allowance < amount : true;

  // 2. Approve (only called when needsApproval)
  const approveWrite = useWriteContract();
  async function approve() {
    if (!owner) throw new Error('Wallet not connected');
    return approveWrite.writeContractAsync({
      address: tokenAddress,
      abi: erc20.abi,
      functionName: "approve",
      args: [spender, amount],
      account: owner,
      chainId
    });
  }
  const approveReceipt = useWaitForTransactionReceipt({
    hash: approveWrite.data,
    query: { enabled: !!approveWrite.data },
  });

  // 3. Simulate target write — surfaces revert reasons before wallet popup
  const simulate = useSimulateContract({
    address: target.address as `0x${string}`,
    abi: target.abi as Abi,
    functionName: targetFn,
    args: targetArgs as unknown[],
    query: { enabled: !needsApproval && enabled && !!owner },
  });

  // 4. Execute target write
  const executeWrite = useWriteContract();
  async function execute() {
    if (!simulate.data?.request) {
      throw new Error('Simulation not ready — check simulateError before calling execute()');
    }
    return executeWrite.writeContractAsync(
      simulate.data.request as Parameters<typeof executeWrite.writeContractAsync>[0]
    );
  }
  const executeReceipt = useWaitForTransactionReceipt({
    hash: executeWrite.data,
    query: { enabled: !!executeWrite.data },
  });

  return {
    needsApproval,
    approve,
    approveStatus: approveReceipt.status,
    approvePending: approveWrite.isPending,
    approveError: approveWrite.error,
    refetchAllowance,
    simulateError: simulate.error,
    execute,
    executeStatus: executeReceipt.status,
    executePending: executeWrite.isPending,
    executeError: executeWrite.error,
    executeHash: executeWrite.data,
  };
}
