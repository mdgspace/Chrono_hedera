import { ethers } from 'ethers';
import { CONTRACTS } from './contracts';
import { ERC20_ABI, CHRONO_ROUTER_ABI } from './abis';

export async function lend(signer, tokenAddress, amount) {
  const router = new ethers.Contract(CONTRACTS.ChronoRouter, CHRONO_ROUTER_ABI, signer);
  const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, signer);

  // 1. Approve router
  const txApprove = await erc20.approve(CONTRACTS.ChronoRouter, amount);
  await txApprove.wait();

  // 2. Deposit via router (which forwards to LendingPool and returns shares)
  const tx = await router.deposit(tokenAddress, amount);
  const receipt = await tx.wait();

  return { txHash: receipt.hash, receipt };
}
