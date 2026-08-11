import { ethers } from "ethers";

/**
 * 5. Deposit in Stability Pool Flow
 * @param signer The user's wallet signer
 * @param stabilityPoolAddress Address of StabilityPool
 * @param tokenAddress Address of token to deposit (e.g. wUSDC)
 * @param amount Amount to deposit (in token decimals)
 */
export async function depositSP(
    signer: ethers.Signer,
    stabilityPoolAddress: string,
    tokenAddress: string,
    amount: bigint
) {
    const erc20Abi = ["function approve(address spender, uint256 amount) public returns (bool)"];
    const spAbi = ["function provideToSP(address token, uint256 amount) external"];
    
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, signer);
    const spContract = new ethers.Contract(stabilityPoolAddress, spAbi, signer);

    console.log("Approving StabilityPool...");
    const approveTx = await tokenContract.approve(stabilityPoolAddress, amount);
    await approveTx.wait();

    console.log("Depositing to Stability Pool...");
    const tx = await spContract.provideToSP(tokenAddress, amount);
    await tx.wait();

    console.log("Deposit SP successful!");
}
