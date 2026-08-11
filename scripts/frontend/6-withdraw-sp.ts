import { ethers } from "ethers";

/**
 * 6. Withdraw from Stability Pool Flow
 * @param signer The user's wallet signer
 * @param stabilityPoolAddress Address of StabilityPool
 * @param tokenAddress Address of token to withdraw (e.g. wUSDC)
 * @param amount Amount of underlying token to withdraw
 */
export async function withdrawSP(
    signer: ethers.Signer,
    stabilityPoolAddress: string,
    tokenAddress: string,
    amount: bigint
) {
    const spAbi = ["function withdrawFromSP(address token, uint256 amount) external"];
    const spContract = new ethers.Contract(stabilityPoolAddress, spAbi, signer);

    console.log("Withdrawing from Stability Pool...");
    const tx = await spContract.withdrawFromSP(tokenAddress, amount);
    await tx.wait();

    console.log("Withdraw SP successful!");
}
