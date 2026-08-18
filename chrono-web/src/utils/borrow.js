import { ethers } from 'ethers';
import { CONTRACTS } from './contracts';
import { ERC20_ABI, CHRONO_ROUTER_ABI } from './abis';

export async function borrow(signer, collateralToken, debtToken, collateralAmount, borrowAmount, durationSeconds) {
  const router = new ethers.Contract(CONTRACTS.ChronoRouter, CHRONO_ROUTER_ABI, signer);
  const collatErc20 = new ethers.Contract(collateralToken, ERC20_ABI, signer);

  // 1. Approve router
  const txApprove = await collatErc20.approve(CONTRACTS.ChronoRouter, collateralAmount, { gasLimit: 1000000 });
  await txApprove.wait();

  // 2. Open Position
  const tx = await router.openPosition(
    collateralToken,
    debtToken,
    collateralAmount,
    borrowAmount,
    durationSeconds,
    { gasLimit: 3000000 }
  );
  
  const receipt = await tx.wait();

  // 3. Parse Event (PositionOpened)
  // But ChronoRouter emits it via BorrowVault. We can just return tx hash, or try to parse if needed.
  // Returning receipt allows caller to inspect logs.
  let positionId = null;
  // Fallback simple parsing of the event from the receipt logs if ABI was provided for Vault, 
  // but for now returning the hash is most important.
  
  return { txHash: receipt.hash, receipt };
}
