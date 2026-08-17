import { executeTransaction } from './flowWallet'
import * as fcl from '@onflow/fcl'
import * as t from '@onflow/types'

// Cadence transaction for borrowing additional tokens against existing collateral
const BORROW_MORE_TX = `
import FungibleToken from 0x9a0766d93b6608b7
import FlowToken from 0x7e60df042a9c0868
import TimeLendingProtocol2 from 0x904a8cd375b62ddc
import WrappedETH1 from 0xe11cab85e85ae137
import WrappedUSDC1 from 0xe11cab85e85ae137
import BandOracle from 0x9fb6606c300b5051

// Transaction to borrow additional tokens against existing collateral
// This increases the debt on an existing borrowing position without adding more collateral

transaction(
    positionId: UInt64,            // Existing borrowing position ID
    additionalBorrowAmount: UFix64 // Additional amount to borrow
) {
    
    let borrowingManagerRef: &TimeLendingProtocol2.BorrowingManager
    let borrowedTokensReceiver: &{FungibleToken.Receiver}
    let oraclePayment: @{FungibleToken.Vault}
    let position: TimeLendingProtocol2.BorrowingPosition
    let signerAddress: Address
    let borrowAuth: auth(Storage) &Account

    prepare(signer: auth(BorrowValue, Storage, Capabilities) &Account) {
        self.signerAddress = signer.address
        self.borrowAuth = signer

        // Get the existing borrowing position
        self.position = TimeLendingProtocol2.getBorrowingPosition(id: positionId)
            ?? panic("Position does not exist")
        
        // Verify the signer is the borrower
        if self.position.borrower != signer.address {
            panic("Only the position owner can borrow more")
        }
        
        if !self.position.isActive {
            panic("Position is not active")
        }
        
        // Get reference to the borrowing manager
        self.borrowingManagerRef = TimeLendingProtocol2.borrowBorrowingManager()
        
        // Get prices to calculate current state
        let protocolParams = TimeLendingProtocol2.getProtocolParameters()
        let collateralSymbol = TimeLendingProtocol2.getTokenSymbol(tokenType: self.position.collateralType)
        let borrowSymbol = TimeLendingProtocol2.getTokenSymbol(tokenType: self.position.borrowTokenType)
        
        let collateralPrice = TimeLendingProtocol2.getCachedPrice(symbol: collateralSymbol) ?? 1.0
        let borrowPrice = TimeLendingProtocol2.getCachedPrice(symbol: borrowSymbol) ?? 1.0
        
        // Calculate current state
        let collateralValueUSD = self.position.collateralAmount * collateralPrice
        let currentBorrowUSD = self.position.borrowAmount * borrowPrice
        let additionalBorrowUSD = additionalBorrowAmount * borrowPrice
        let newTotalBorrowUSD = currentBorrowUSD + additionalBorrowUSD
        let maxBorrowUSD = collateralValueUSD * self.position.calculatedLTV
        
        log("Current Position State:")
        log("  Position ID: ".concat(positionId.toString()))
        log("  Collateral: ".concat(self.position.collateralAmount.toString()).concat(" ").concat(collateralSymbol))
        log("  Collateral Value (USD): $".concat(collateralValueUSD.toString()))
        log("  Current Borrow: ".concat(self.position.borrowAmount.toString()).concat(" ").concat(borrowSymbol))
        log("  Current Borrow (USD): $".concat(currentBorrowUSD.toString()))
        log("  Current LTV: ".concat(((currentBorrowUSD / collateralValueUSD) * 100.0).toString()).concat("%"))
        log("  Position LTV Limit: ".concat((self.position.calculatedLTV * 100.0).toString()).concat("%"))
        log("  Max Borrow Capacity (USD): $".concat(maxBorrowUSD.toString()))
        log("")
        log("New Borrow Request:")
        log("  Additional Amount: ".concat(additionalBorrowAmount.toString()).concat(" ").concat(borrowSymbol))
        log("  Additional (USD): $".concat(additionalBorrowUSD.toString()))
        log("  New Total Borrow (USD): $".concat(newTotalBorrowUSD.toString()))
        log("  New LTV: ".concat(((newTotalBorrowUSD / collateralValueUSD) * 100.0).toString()).concat("%"))
        log("  Remaining Capacity (USD): $".concat((maxBorrowUSD).toString()))

        // Setup receiver for borrowed tokens based on borrow token type
        let borrowTokenType = self.position.borrowTokenType
            // Receiving USDC
            self.borrowedTokensReceiver = signer.capabilities.get<&{FungibleToken.Receiver}>(
                WrappedUSDC1.ReceiverPublicPath
            ).borrow() ?? panic("Could not borrow WrappedUSDC receiver capability. Make sure you have WrappedUSDC1 vault set up.")
        
        // Withdraw FLOW tokens for oracle payment
        let flowVault = signer.storage.borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(
            from: /storage/flowTokenVault
        ) ?? panic("Could not borrow FLOW vault from storage")
        
        self.oraclePayment <- flowVault.withdraw(amount: BandOracle.getFee())
    }
    
    execute {
        // Borrow more tokens against existing collateral
        self.borrowingManagerRef.borrowMore(
            positionId: positionId,
            additionalBorrowAmount: additionalBorrowAmount,
            borrowedTokensRecipient: self.borrowedTokensReceiver,
            oraclePayment: <- self.oraclePayment,
            borrowerAuth: self.borrowAuth
        )
        
        // Get updated position
        let updatedPosition = TimeLendingProtocol2.getBorrowingPosition(id: positionId)!
        
        log("")
        log("✅ Successfully borrowed additional tokens!")
        log("  Additional Borrowed: ".concat(additionalBorrowAmount.toString()))
        log("  New Total Debt: ".concat(updatedPosition.borrowAmount.toString()))
        log("  New Health Factor: ".concat(updatedPosition.healthFactor.toString()))
        log("  Position ID: #".concat(positionId.toString()))
    }
}
`

/**
 * Borrow additional tokens against existing collateral
 * @param {string|number} positionId - The borrowing position ID
 * @param {string|number} additionalBorrowAmount - Additional amount to borrow
 * @returns {Promise<string>} Transaction ID
 */
export async function borrowMore(positionId, additionalBorrowAmount) {
  if (positionId === undefined || positionId === null) {
    throw new Error('positionId is required')
  }
  if (additionalBorrowAmount === undefined || additionalBorrowAmount === null) {
    throw new Error('additionalBorrowAmount is required')
  }

  const args = [
    fcl.arg(String(positionId), t.UInt64),
    fcl.arg(parseFloat(additionalBorrowAmount).toFixed(8), t.UFix64)
  ]

  return executeTransaction(BORROW_MORE_TX, args)
}



