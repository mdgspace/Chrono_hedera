import { ethers } from "ethers";

/**
 * 1. Borrow Flow
 * Frontend usage: Connect wallet, get signer, call this function.
 * @param signer The user's wallet signer
 * @param routerAddress Address of ChronoRouter
 * @param vaultAddress Address of BorrowVault
 * @param collateralToken Address of collateral token (e.g. wETH)
 * @param debtToken Address of debt token (e.g. wUSDC)
 * @param collateralAmount Amount to deposit (in token decimals, e.g. 100000000 for 1 wETH if 8 decimals)
 * @param borrowAmount Amount to borrow (in token decimals)
 * @param durationSeconds Duration of the loan in seconds
 */
export async function borrow(
    signer: ethers.Signer,
    routerAddress: string,
    vaultAddress: string,
    collateralToken: string,
    debtToken: string,
    collateralAmount: bigint,
    borrowAmount: bigint,
    durationSeconds: number
) {
    const erc20Abi = ["function approve(address spender, uint256 amount) public returns (bool)"];
    const routerAbi = ["function openPosition(address collateralToken, address debtToken, uint256 collateralAmount, uint256 borrowAmount, uint256 durationSeconds) external returns (bytes32 positionId)"];
    const vaultAbi = ["event PositionOpened(bytes32 indexed positionId, address indexed borrower, address collateralToken, address debtToken)"];
    
    const tokenContract = new ethers.Contract(collateralToken, erc20Abi, signer);
    const routerContract = new ethers.Contract(routerAddress, routerAbi, signer);
    const vaultContract = new ethers.Contract(vaultAddress, vaultAbi, signer);

    console.log("Approving ChronoRouter...");
    const approveTx = await tokenContract.approve(routerAddress, collateralAmount);
    await approveTx.wait();

    console.log("Opening borrow position...");
    const tx = await routerContract.openPosition(
        collateralToken,
        debtToken,
        collateralAmount,
        borrowAmount,
        durationSeconds
    );
    const receipt = await tx.wait();

    let posId = "";
    for (const log of receipt.logs) {
        try {
            const parsed = vaultContract.interface.parseLog({ topics: log.topics as string[], data: log.data });
            if (parsed && parsed.name === "PositionOpened") {
                posId = parsed.args.positionId;
                break;
            }
        } catch (e) {
            // Ignore unrelated logs
        }
    }

    console.log(`Borrow successful! Position ID: ${posId}`);
    return posId;
}
