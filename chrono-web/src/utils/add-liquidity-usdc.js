import * as fcl from '@onflow/fcl'
import { executeTransaction } from './flowWallet'

// Cadence transaction copied from cadence/transactions/stabiltyPoolsUSDC.cdc
const ADD_LIQUIDITY_USDC_TX = `
import FungibleToken from 0x9a0766d93b6608b7
import FlowToken from 0x7e60df042a9c0868
import WrappedUSDC1 from 0xe11cab85e85ae137
import LiquidationPool from 0xe11cab85e85ae137
import BandOracle from 0x9fb6606c300b5051

transaction(usdcAmount: UFix64) {
    
    let usdcVault: @WrappedUSDC1.Vault
    let oraclePayment: @FlowToken.Vault
    let signerAddress: Address
    
    prepare(signer: auth(BorrowValue) &Account) {
        self.signerAddress = signer.address
        
        // Withdraw USDC from signer's vault
        let usdcVaultRef = signer.storage.borrow<auth(FungibleToken.Withdraw) &WrappedUSDC1.Vault>(
            from: WrappedUSDC1.VaultStoragePath
        ) ?? panic("Could not borrow USDC vault reference")
        
        self.usdcVault <- usdcVaultRef.withdraw(amount: usdcAmount) as! @WrappedUSDC1.Vault
        
        // Withdraw Flow for oracle payment
        let flowVaultRef = signer.storage.borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(
            from: /storage/flowTokenVault
        ) ?? panic("Could not borrow Flow vault reference")
        
        self.oraclePayment <- flowVaultRef.withdraw(amount: BandOracle.getFee()) as! @FlowToken.Vault
        
    
    }
    
    execute {
        // Add USDC liquidity to the pool
        let sharesMinted = LiquidationPool.contributeUSDC(
            usdcVault: <-self.usdcVault,
            contributor: self.signerAddress,
            oraclePayment: <-self.oraclePayment
        )
        
        log("Successfully added USDC liquidity. Shares minted: ".concat(sharesMinted.toString()))
    }
}
`

export async function addLiquidityUSDC(amount) {
  // Ensure proper UFix64 string (e.g., 10.0)
  const normalized = Number(amount);
  if (!normalized || normalized <= 0) {
    throw new Error('Invalid amount');
  }
  const amountStr = normalized.toFixed(1);

  return await executeTransaction(ADD_LIQUIDITY_USDC_TX, [
    fcl.arg(amountStr, fcl.t.UFix64)
  ])
}





