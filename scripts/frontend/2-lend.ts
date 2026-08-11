import { ethers } from "ethers";

/**
 * 2. Lend Flow (Synonymous with depositing into the Lending Pool)
 * @param signer The user's wallet signer
 * @param poolAddress Address of LendingPool
 * @param tokenAddress Address of token to lend (e.g. wUSDC)
 * @param amount Amount to lend (in token decimals)
 */
export async function lend(
    signer: ethers.Signer,
    poolAddress: string,
    tokenAddress: string,
    amount: bigint
) {
    const erc20Abi = ["function approve(address spender, uint256 amount) public returns (bool)"];
    const poolAbi = ["function deposit(address token, uint256 amount) external"];
    
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, signer);
    const poolContract = new ethers.Contract(poolAddress, poolAbi, signer);

    console.log("Approving LendingPool...");
    const approveTx = await tokenContract.approve(poolAddress, amount);
    await approveTx.wait();

    console.log("Lending (Depositing to LP)...");
    const tx = await poolContract.deposit(tokenAddress, amount);
    await tx.wait();

    console.log("Lend successful!");
}
