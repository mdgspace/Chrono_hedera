import { executeTransaction } from './flowWallet'
import * as fcl from '@onflow/fcl'

// Cadence transaction for repaying a loan and retrieving collateral
const REPAY_LOAN_TX = `
import FungibleToken from 0x9a0766d93b6608b7
import TimeLendingProtocol2 from 0x904a8cd375b62ddc
import WrappedETH1 from 0xe11cab85e85ae137
import WrappedUSDC1 from 0xe11cab85e85ae137

transaction(positionId: UInt64) {
    let borrowingManagerRef: &TimeLendingProtocol2.BorrowingManager
    let repaymentVault: @{FungibleToken.Vault}
    let collateralRecipient: &{FungibleToken.Receiver}
    let position: TimeLendingProtocol2.BorrowingPosition
    let totalRepayment: UFix64
    let borrowerAuth: auth(Storage) &Account
    
    prepare(signer: auth(BorrowValue, Storage, Capabilities) &Account) {
        self.position = TimeLendingProtocol2.getBorrowingPosition(id: positionId)
            ?? panic("Position does not exist")
        if !self.position.isActive {
            panic("Position is not active")
        }
        self.borrowerAuth = signer
        self.borrowingManagerRef = TimeLendingProtocol2.borrowBorrowingManager()

        let timeElapsed = getCurrentBlock().timestamp - self.position.timestamp
        let protocolParams = TimeLendingProtocol2.getProtocolParameters()
        let annualRate = protocolParams["baseInterestRate"] as! UFix64
        let interest = self.position.borrowAmount * annualRate * timeElapsed / 31536000.0
        self.totalRepayment = self.position.borrowAmount + interest

        // Repaying USDC loan (adjust as your protocol expands)
        let usdcVault = signer.storage.borrow<auth(FungibleToken.Withdraw) &{FungibleToken.Vault}>(
            from: WrappedUSDC1.VaultStoragePath
        ) ?? panic("Could not borrow WrappedUSDC vault from storage")
        self.repaymentVault <- usdcVault.withdraw(amount: self.totalRepayment)

        // Return ETH collateral to borrower
        self.collateralRecipient = signer.capabilities.get<&{FungibleToken.Receiver}>(
            WrappedETH1.ReceiverPublicPath
        ).borrow() ?? panic("Could not borrow WrappedETH receiver capability")
    }

    execute {
        self.borrowingManagerRef.repayLoan(
            positionId: positionId,
            repaymentVault: <- self.repaymentVault,
            collateralRecipient: self.collateralRecipient,
            borrowerAuth: self.borrowerAuth
        )
    }
}
`

export async function repayLoan(positionId) {
  if (positionId === undefined || positionId === null) throw new Error('positionId is required')
  return executeTransaction(REPAY_LOAN_TX, [
    fcl.arg(String(positionId), fcl.t.UInt64)
  ])
}







