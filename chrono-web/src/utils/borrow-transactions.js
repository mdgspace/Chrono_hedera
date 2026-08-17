import * as fcl from '@onflow/fcl'
import * as t from '@onflow/types'
import { executeTransaction } from './flowWallet'

// Borrow USDC using WETH collateral (same as borrow-transaction-eth.js cadence)
const BORROW_USDC_TX = `import FlowTransactionScheduler from 0x8c5303eaa26202d6
import FlowTransactionSchedulerUtils from 0x8c5303eaa26202d6
import FungibleToken from 0x9a0766d93b6608b7
import FlowToken from 0x7e60df042a9c0868
import LiquidationPoolTransactionHandler from 0xe11cab85e85ae137
import TimeLendingProtocol2 from 0x904a8cd375b62ddc
import WrappedETH1 from 0xe11cab85e85ae137
import WrappedUSDC1 from 0xe11cab85e85ae137
import BandOracle from 0x9fb6606c300b5051

/// Schedule an increment of the Counter with a relative delay in seconds using the manager
transaction(
    delaySeconds: UFix64,
    collateralAmount: UFix64,      // Amount of Wrapped ETH to use as collateral
    borrowAmount: UFix64,
) {
    let borrowingManagerRef: &TimeLendingProtocol2.BorrowingManager
    let borrowedTokensReceiver: &{FungibleToken.Receiver}
    let signerAddress: Address
    
    prepare(signer: auth(BorrowValue, IssueStorageCapabilityController, SaveValue, GetStorageCapabilityController, PublishCapability, Storage, Capabilities) &Account) {

        self.signerAddress = signer.address
        
        // Get reference to the borrowing manager
        self.borrowingManagerRef = TimeLendingProtocol2.borrowBorrowingManager()
        
        // Get receiver capability for borrowed USDC tokens using WrappedUSDC1 paths
        self.borrowedTokensReceiver = signer.capabilities.get<&{FungibleToken.Receiver}>(
            WrappedUSDC1.ReceiverPublicPath
        ).borrow() ?? panic("Could not borrow USDC receiver capability. Make sure you have WrappedUSDC1 vault set up.")
        
        // Withdraw Wrapped ETH collateral from signer's vault using WrappedETH1 paths
        let wrappedETHVault = signer.storage.borrow<auth(FungibleToken.Withdraw) &{FungibleToken.Vault}>(
            from: WrappedETH1.VaultStoragePath
        ) ?? panic("Could not borrow Wrapped ETH vault from storage. Make sure you have WrappedETH1 vault set up.")
        
        let collateralVault <- wrappedETHVault.withdraw(amount: collateralAmount)
        
        // Withdraw FLOW tokens for oracle payment using BandOracle fee
        let flowVault = signer.storage.borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(
            from: /storage/flowTokenVault
        ) ?? panic("Could not borrow FLOW vault from storage")
        
        let oraclePayment1 <- flowVault.withdraw(amount: BandOracle.getFee())
        let oraclePayment2 <- flowVault.withdraw(amount: BandOracle.getFee())

        // Create borrowing position - move resources immediately
        let positionId = self.borrowingManagerRef.createBorrowingPosition(
            collateralVault: <- collateralVault,
            borrowTokenType: Type<@WrappedUSDC1.Vault>(),
            borrowAmount: borrowAmount,
            durationMinutes: UInt64(delaySeconds / 60.0),
            borrower: self.signerAddress,
            borrowerRecipient: self.borrowedTokensReceiver,
            oraclePayment1: <- oraclePayment1,
            oraclePayment2: <- oraclePayment2
        )

        let transactionData = LiquidationPoolTransactionHandler.PositionData(
            positionId: positionId!,
            debtTokenType: "USDC"
        )

        let future = getCurrentBlock().timestamp + delaySeconds
        let priority = 1

         let pr = priority == 0
            ? FlowTransactionScheduler.Priority.High
            : priority == 1
                ? FlowTransactionScheduler.Priority.Medium
                : FlowTransactionScheduler.Priority.Low

        // Get the entitled capability that will be used to create the transaction
        // Need to check both controllers because the order of controllers is not guaranteed
        var handlerCap: Capability<auth(FlowTransactionScheduler.Execute) &{FlowTransactionScheduler.TransactionHandler}>? = nil
        if let cap = signer.capabilities.storage
                            .getControllers(forPath: /storage/LiquidationPoolTransactionHandler)[0]
                            .capability as? Capability<auth(FlowTransactionScheduler.Execute) &{FlowTransactionScheduler.TransactionHandler}> {
            handlerCap = cap
        } else {
            handlerCap = signer.capabilities.storage
                            .getControllers(forPath: /storage/LiquidationPoolTransactionHandler)[1]
                            .capability as! Capability<auth(FlowTransactionScheduler.Execute) &{FlowTransactionScheduler.TransactionHandler}>
        }

        // Save a manager resource to storage if not already present
        if signer.storage.borrow<&AnyResource>(from: FlowTransactionSchedulerUtils.managerStoragePath) == nil {
            let manager <- FlowTransactionSchedulerUtils.createManager()
            signer.storage.save(<-manager, to: FlowTransactionSchedulerUtils.managerStoragePath)
        
            // Create a capability for the Manager
            let managerCapPublic = signer.capabilities.storage.issue<&{FlowTransactionSchedulerUtils.Manager}>(FlowTransactionSchedulerUtils.managerStoragePath)
            signer.capabilities.publish(managerCapPublic, at: FlowTransactionSchedulerUtils.managerPublicPath)
        }
        // Borrow the manager
        let manager = signer.storage.borrow<auth(FlowTransactionSchedulerUtils.Owner) &{FlowTransactionSchedulerUtils.Manager}>(from: FlowTransactionSchedulerUtils.managerStoragePath)
            ?? panic("Could not borrow a Manager reference from \(FlowTransactionSchedulerUtils.managerStoragePath)")

        // Withdraw fees
        let vaultRef = signer.storage
            .borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(from: /storage/flowTokenVault)
            ?? panic("missing FlowToken vault")
        
        let est = FlowTransactionScheduler.estimate(
            data: transactionData,
            timestamp: future,
            priority: pr,
            executionEffort: 1000
        )

        assert(
            est.timestamp != nil || pr == FlowTransactionScheduler.Priority.Low,
            message: est.error ?? "estimation failed"
        )
        
        let fees <- vaultRef.withdraw(amount: est.flowFee ?? 0.0) as! @FlowToken.Vault

        // Schedule through the manager
        let transactionId = manager.schedule(
            handlerCap: handlerCap ?? panic("Could not borrow handler capability"),
            data: transactionData,
            timestamp: future,
            priority: pr,
            executionEffort: 1000,
            fees: <-fees
        )

        log("Scheduled transaction id: ".concat(transactionId.toString()).concat(" at ").concat(future.toString()))
    }
}
`

// Borrow USDC using FLOW collateral
const BORROW_USDC_FLOW_COLLATERAL_TX = ``

// Borrow FLOW using WETH collateral
const BORROW_FLOW_TX = `
import FungibleToken from 0x9a0766d93b6608b7
import FlowToken from 0x7e60df042a9c0868
import TimeLendingProtocol2 from 0x904a8cd375b62ddc
import WrappedETH1 from 0xe11cab85e85ae137
import BandOracle from 0x9fb6606c300b5051

transaction(
    collateralAmount: UFix64,
    borrowAmount: UFix64,
    durationMinutes: UInt64
) {
    let borrowingManagerRef: &TimeLendingProtocol2.BorrowingManager
    let collateralVault: @{FungibleToken.Vault}
    let borrowedTokensReceiver: &{FungibleToken.Receiver}
    let oraclePayment1: @{FungibleToken.Vault}
    let oraclePayment2: @{FungibleToken.Vault}
    let signerAddress: Address
    
    prepare(signer: auth(BorrowValue, Storage, Capabilities) &Account) {
        self.signerAddress = signer.address
        self.borrowingManagerRef = TimeLendingProtocol2.borrowBorrowingManager()
        let wrappedETHVault = signer.storage.borrow<auth(FungibleToken.Withdraw) &{FungibleToken.Vault}>(
            from: WrappedETH1.VaultStoragePath
        ) ?? panic("Could not borrow Wrapped ETH vault from storage. Make sure you have WrappedETH1 vault set up.")
        self.collateralVault <- wrappedETHVault.withdraw(amount: collateralAmount)
        self.borrowedTokensReceiver = signer.capabilities.get<&{FungibleToken.Receiver}>(
            /public/flowTokenReceiver
        ).borrow() ?? panic("Could not borrow FLOW receiver capability. Make sure you have FLOW vault set up.")
        let flowVault = signer.storage.borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(
            from: /storage/flowTokenVault
        ) ?? panic("Could not borrow FLOW vault from storage")
        self.oraclePayment1 <- flowVault.withdraw(amount: BandOracle.getFee())
        self.oraclePayment2 <- flowVault.withdraw(amount: BandOracle.getFee())
    }
    
    execute {
        let positionId = self.borrowingManagerRef.createBorrowingPosition(
            collateralVault: <- self.collateralVault,
            borrowTokenType: Type<@FlowToken.Vault>(),
            borrowAmount: borrowAmount,
            durationMinutes: durationMinutes,
            borrower: self.signerAddress,
            borrowerRecipient: self.borrowedTokensReceiver,
            oraclePayment1: <- self.oraclePayment1,
            oraclePayment2: <- self.oraclePayment2
        )
        if positionId == nil { panic("Failed to create borrowing position - borrow amount exceeds LTV limit") }
    }
}`

export async function createBorrowUSDC(collateralAmount, borrowAmount, durationMinutes) {
  const args = [
    fcl.arg(parseFloat(durationMinutes * 60).toFixed(8), t.UFix64),
    fcl.arg(parseFloat(collateralAmount).toFixed(8), t.UFix64),
    fcl.arg(parseFloat(borrowAmount).toFixed(8), t.UFix64)
    
  ]
  return executeTransaction(BORROW_USDC_TX, args)
}

export async function createBorrowWETH(collateralAmount, borrowAmount, durationMinutes) {
  const args = [
    fcl.arg(parseFloat(collateralAmount).toFixed(8), t.UFix64),
    fcl.arg(parseFloat(borrowAmount).toFixed(8), t.UFix64),
    fcl.arg(String(durationMinutes), t.UInt64)
  ]
  return executeTransaction(BORROW_WETH_TX, args)
}

export async function createBorrowFLOW(collateralAmount, borrowAmount, durationMinutes) {
  const args = [
    fcl.arg(parseFloat(collateralAmount).toFixed(8), t.UFix64),
    fcl.arg(parseFloat(borrowAmount).toFixed(8), t.UFix64),
    fcl.arg(String(durationMinutes), t.UInt64)
  ]
  return executeTransaction(BORROW_FLOW_TX, args)
}

export async function createBorrowUSDCWithFlowCollateral(collateralAmount, borrowAmount, durationMinutes) {
  const args = [
    fcl.arg(parseFloat(collateralAmount).toFixed(8), t.UFix64),
    fcl.arg(parseFloat(borrowAmount).toFixed(8), t.UFix64),
    fcl.arg(String(durationMinutes), t.UInt64)
  ]
  return executeTransaction(BORROW_USDC_FLOW_COLLATERAL_TX, args)
}


