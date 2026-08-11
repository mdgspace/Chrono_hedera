import { ethers } from "ethers";

/**
 * 4. Withdraw from LP Flow
 * @param signer The user's wallet signer
 * @param poolAddress Address of LendingPool
 * @param tokenAddress Address of token to withdraw (e.g. wUSDC)
 * @param sharesAmount Amount of shares to withdraw/burn
 */
export async function withdrawLP(
    signer: ethers.Signer,
    poolAddress: string,
    tokenAddress: string,
    sharesAmount: bigint
) {
    const poolAbi = ["function withdraw(address token, uint256 shares) external"];
    const poolContract = new ethers.Contract(poolAddress, poolAbi, signer);

    console.log("Withdrawing from LendingPool...");
    const tx = await poolContract.withdraw(tokenAddress, sharesAmount);
    await tx.wait();

    console.log("Withdraw successful!");
}
