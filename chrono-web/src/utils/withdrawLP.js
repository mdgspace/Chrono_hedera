import { ethers } from 'ethers';
import { CONTRACTS } from './contracts';
import { LENDING_POOL_ABI } from './abis';

export async function withdrawLP(signer, tokenAddress, sharesAmount) {
  const lendingPool = new ethers.Contract(CONTRACTS.LendingPool, LENDING_POOL_ABI, signer);

  // No approve needed for burning own shares
  const tx = await lendingPool.withdraw(tokenAddress, sharesAmount);
  const receipt = await tx.wait();

  return { txHash: receipt.hash, receipt };
}
