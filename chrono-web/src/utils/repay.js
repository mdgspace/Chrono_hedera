import { ethers } from 'ethers';
import { CONTRACTS } from './contracts';
import { ERC20_ABI, CHRONO_ROUTER_ABI, BORROW_VAULT_ABI } from './abis';

export async function repay(signer, positionId, amount) {
  const router = new ethers.Contract(CONTRACTS.ChronoRouter, CHRONO_ROUTER_ABI, signer);
  const borrowVault = new ethers.Contract(CONTRACTS.BorrowVault, BORROW_VAULT_ABI, signer);

  // 1. Get position details to find debtToken
  const position = await borrowVault.getPosition(positionId);
  const debtToken = position.debtToken;

  const erc20 = new ethers.Contract(debtToken, ERC20_ABI, signer);

  // 2. Approve Router
  const txApprove = await erc20.approve(CONTRACTS.ChronoRouter, amount);
  await txApprove.wait();

  // 3. Repay via Router
  const tx = await router.repay(positionId, amount);
  const receipt = await tx.wait();

  return { txHash: receipt.hash, receipt };
}
