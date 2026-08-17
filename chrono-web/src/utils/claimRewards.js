import { ethers } from 'ethers';
import { CONTRACTS } from './contracts';
import { STABILITY_POOL_ABI } from './abis';

export async function claimRewards(signer, debtTokenAddress) {
  const stabilityPool = new ethers.Contract(CONTRACTS.StabilityPool, STABILITY_POOL_ABI, signer);

  const tx = await stabilityPool.claimCollateralRewards(debtTokenAddress);
  const receipt = await tx.wait();

  return { txHash: receipt.hash, receipt };
}
