import { ethers } from 'ethers';
import { CONTRACTS } from './contracts';
import { ERC20_ABI, BORROW_VAULT_ABI } from './abis';

export async function topUpCollateral(signer, positionId, amount) {
  const borrowVault = new ethers.Contract(CONTRACTS.BorrowVault, BORROW_VAULT_ABI, signer);

  // 1. Get position details to find collateralToken
  const position = await borrowVault.getPosition(positionId);
  const collateralToken = position.collateralToken;

  const erc20 = new ethers.Contract(collateralToken, ERC20_ABI, signer);

  // 2. Approve BorrowVault
  const txApprove = await erc20.approve(CONTRACTS.BorrowVault, amount);
  await txApprove.wait();

  // 3. Top up collateral
  const tx = await borrowVault.topUpCollateral(positionId, amount);
  const receipt = await tx.wait();

  return { txHash: receipt.hash, receipt };
}
