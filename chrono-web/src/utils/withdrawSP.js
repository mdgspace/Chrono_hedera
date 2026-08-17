import { ethers } from 'ethers';
import { CONTRACTS } from './contracts';
import { STABILITY_POOL_ABI } from './abis';

export async function withdrawSP(signer, debtTokenAddress, amount) {
  const stabilityPool = new ethers.Contract(CONTRACTS.StabilityPool, STABILITY_POOL_ABI, signer);

  // No approve needed
  const tx = await stabilityPool.withdraw(debtTokenAddress, amount);
  const receipt = await tx.wait();

  return { txHash: receipt.hash, receipt };
}
