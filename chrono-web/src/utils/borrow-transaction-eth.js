import * as fcl from "@onflow/fcl";
import * as t from "@onflow/types"; // Make sure you import types as 't'
import { executeTransaction } from './flowWallet'; 

/**
 * Creates a new Time Lending Borrowing Position using WETH as collateral to borrow USDC.
 * @param {string} collateralAmount - Amount of Wrapped ETH to deposit (UFix64 as string).
 * @param {string} borrowAmount - Amount of Wrapped USDC to borrow (UFix64 as string).
 * @param {string} durationMinutes - Duration of the loan in minutes (UInt64 as string).
 * @returns {Promise<string>} The transaction ID.
 */
export const createBorrowingPosition = async (
    collateralAmount, 
    borrowAmount, 
    durationMinutes
) => {
    // The complete Cadence transaction code as a string - CLEANED OF U+00A0 characters
    const createBorrowingCadence = `
        import FungibleToken from 0x9a0766d93b6608b7
import FlowToken from 0x7e60df042a9c0868
import TimeLendingProtocol2 from 0x904a8cd375b62ddc
import WrappedETH1 from 0xe11cab85e85ae137
import WrappedUSDC1 from 0xe11cab85e85ae137
import BandOracle from 0x9fb6606c300b5051

// Transaction to borrow USDC using Wrapped ETH as collateral
transaction(
    collateralAmount: UFix64,      // Amount of Wrapped ETH to use as collateral
    borrowAmount: UFix64,           // Amount of USDC to borrow
    durationMinutes: UInt64         // Duration of the loan in minutes
) {
    
    let borrowingManagerRef: &TimeLendingProtocol2.BorrowingManager
    let collateralVault: @{FungibleToken.Vault}
    let borrowedTokensReceiver: &{FungibleToken.Receiver}
    let oraclePayment1: @{FungibleToken.Vault}
    let oraclePayment2: @{FungibleToken.Vault}
    let signerAddress: Address
    
    prepare(signer: auth(BorrowValue, Storage, Capabilities) &Account) {
        self.signerAddress = signer.address
        
        // Get reference to the borrowing manager
        self.borrowingManagerRef = TimeLendingProtocol2.borrowBorrowingManager()
        
        // Withdraw Wrapped ETH collateral from signer's vault using WrappedETH1 paths
        let wrappedETHVault = signer.storage.borrow<auth(FungibleToken.Withdraw) &{FungibleToken.Vault}>(
            from: WrappedETH1.VaultStoragePath
        ) ?? panic("Could not borrow Wrapped ETH vault from storage. Make sure you have WrappedETH1 vault set up.")
        
        self.collateralVault <- wrappedETHVault.withdraw(amount: collateralAmount)
        
        // Get receiver capability for borrowed USDC tokens using WrappedUSDC1 paths
        self.borrowedTokensReceiver = signer.capabilities.get<&{FungibleToken.Receiver}>(
            WrappedUSDC1.ReceiverPublicPath
        ).borrow() ?? panic("Could not borrow USDC receiver capability. Make sure you have WrappedUSDC1 vault set up.")
        
        // Withdraw FLOW tokens for oracle payment using BandOracle fee
        let flowVault = signer.storage.borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(
            from: /storage/flowTokenVault
        ) ?? panic("Could not borrow FLOW vault from storage")
        
        self.oraclePayment1 <- flowVault.withdraw(amount: BandOracle.getFee())
        self.oraclePayment2 <- flowVault.withdraw(amount: BandOracle.getFee())
    }
    
    execute {
        // Create borrowing position with correct WrappedUSDC1 type
        let positionId = self.borrowingManagerRef.createBorrowingPosition(
            collateralVault: <- self.collateralVault,
            borrowTokenType: Type<@WrappedUSDC1.Vault>(),
            borrowAmount: borrowAmount,
            durationMinutes: durationMinutes,
            borrower: self.signerAddress,
            borrowerRecipient: self.borrowedTokensReceiver,
            oraclePayment1: <- self.oraclePayment1,
            oraclePayment2: <- self.oraclePayment2
        )
        
        if positionId == nil {
            panic("Failed to create borrowing position - borrow amount exceeds LTV limit")
        }
        
        log("Successfully created borrowing position with ID: ".concat(positionId!.toString()))
        log("Collateral locked: ".concat(collateralAmount.toString()).concat(" WrappedETH"))
        log("Borrowed: ".concat(borrowAmount.toString()).concat(" WrappedUSDC"))
        log("Duration: ".concat(durationMinutes.toString()).concat(" minutes"))
    }
}
    `;

    // 2. Construct the FCL Arguments array with correct types
    const transactionArgs = [
        // Arg 1: collateralAmount (UFix64) - FIX: Use t.UFix64 and pass the formatted string
        fcl.arg(parseFloat(collateralAmount).toFixed(8), t.UFix64),
        // Arg 2: borrowAmount (UFix64) - FIX: Use t.UFix64 and pass the formatted string
        fcl.arg(parseFloat(borrowAmount).toFixed(8), t.UFix64),
        // Arg 3: durationMinutes (UInt64) - FIX: Use t.UInt64
        fcl.arg(durationMinutes, t.UInt64), 
    ];

    // 3. Execute the transaction using your utility function
    const txId = await executeTransaction(createBorrowingCadence, transactionArgs);
    
    return txId;
}