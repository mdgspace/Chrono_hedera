import { lend } from "./2-lend";
import { ethers } from "ethers";

/**
 * 3. Deposit in LP Flow
 * In Chrono protocol, lending and depositing into the Lending Pool are the exact same operation.
 * @param signer The user's wallet signer
 * @param poolAddress Address of LendingPool
 * @param tokenAddress Address of token to deposit (e.g. wUSDC)
 * @param amount Amount to deposit (in token decimals)
 */
export async function depositLP(
    signer: ethers.Signer,
    poolAddress: string,
    tokenAddress: string,
    amount: bigint
) {
    // We can just reuse the lend function.
    await lend(signer, poolAddress, tokenAddress, amount);
}
