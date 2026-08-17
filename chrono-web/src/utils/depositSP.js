import { ethers } from 'ethers';
import { CONTRACTS } from './contracts';
import { ERC20_ABI, STABILITY_POOL_ABI } from './abis';

export async function depositSP(signer, debtTokenAddress, amount) {
  const stabilityPool = new ethers.Contract(CONTRACTS.StabilityPool, STABILITY_POOL_ABI, signer);
  const erc20 = new ethers.Contract(debtTokenAddress, ERC20_ABI, signer);

  // 1. Approve StabilityPool
  const txApprove = await erc20.approve(CONTRACTS.StabilityPool, amount);
  await txApprove.wait();

  // 2. Deposit
  const tx = await stabilityPool.deposit(debtTokenAddress, amount);
  const receipt = await tx.wait();

  return { txHash: receipt.hash, receipt };
}
