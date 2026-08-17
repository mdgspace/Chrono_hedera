import * as fcl from "@onflow/fcl";
import { executeTransaction } from './flowWallet';

/**
 * Creates a new Time Lending Position by depositing tokens into the protocol.
 * @param {string} amount - The amount of tokens to lend (e.g., "10.0").
 * @param {string} tokenSymbol - The token symbol: "ETH", "USDC", or "FLOW".
 * @returns {Promise<string>} The transaction ID.
 */
export const createLendingPosition = async (amount, tokenSymbol) => {
  // Normalize token symbol
  const normalizedSymbol = (tokenSymbol || '').toUpperCase();
  let createLendingCadence = '';

  // Generate the appropriate Cadence transaction based on token type
  if (normalizedSymbol === 'ETH' || normalizedSymbol === 'WETH') {
    createLendingCadence = `
      import FungibleToken from 0x9a0766d93b6608b7
      import WrappedETH1 from 0xe11cab85e85ae137
      import TimeLendingProtocol2 from 0x904a8cd375b62ddc

      transaction(amount: UFix64) {
          let lenderVault: @WrappedETH1.Vault 
          let lendingManagerRef: &TimeLendingProtocol2.LendingManager
          let signer: Address
          
          prepare(signer: auth(BorrowValue, Storage) &Account) {
              self.signer = signer.address
              let vaultRef = signer.storage.borrow<auth(FungibleToken.Withdraw) &WrappedETH1.Vault>(
                  from: WrappedETH1.VaultStoragePath
              ) ?? panic("Could not borrow reference to the ETH vault")
              
              self.lenderVault <- vaultRef.withdraw(amount: amount) as! @WrappedETH1.Vault
              self.lendingManagerRef = TimeLendingProtocol2.borrowLendingManager()
          }
          
          execute {
              let positionId = self.lendingManagerRef.createLendingPosition(
                  tokenVault: <-self.lenderVault,
                  lender: self.signer
              )
              
              log("Lending position created with ID: ".concat(positionId.toString()))
          }
      }
    `;
  } else if (normalizedSymbol === 'USDC') {
    createLendingCadence = `
      import FungibleToken from 0x9a0766d93b6608b7
      import WrappedUSDC1 from 0xe11cab85e85ae137
      import TimeLendingProtocol2 from 0x904a8cd375b62ddc

      transaction(amount: UFix64) {
          let lenderVault: @WrappedUSDC1.Vault
          let lendingManagerRef: &TimeLendingProtocol2.LendingManager
          let signer: Address
          
          prepare(signer: auth(BorrowValue, Storage) &Account) {
              self.signer = signer.address
              let vaultRef = signer.storage.borrow<auth(FungibleToken.Withdraw) &WrappedUSDC1.Vault>(
                  from: WrappedUSDC1.VaultStoragePath
              ) ?? panic("Could not borrow reference to the USDC vault")

              self.lenderVault <- vaultRef.withdraw(amount: amount) as! @WrappedUSDC1.Vault
              self.lendingManagerRef = TimeLendingProtocol2.borrowLendingManager()
          }
          
          execute {
              let positionId = self.lendingManagerRef.createLendingPosition(
                  tokenVault: <-self.lenderVault,
                  lender: self.signer
              )
              
              log("Lending position created with ID: ".concat(positionId.toString()))
          }
      }
    `;
  } else if (normalizedSymbol === 'FLOW') {
    createLendingCadence = `
      import FungibleToken from 0x9a0766d93b6608b7
      import FlowToken from 0x7e60df042a9c0868
      import TimeLendingProtocol2 from 0x904a8cd375b62ddc

      transaction(amount: UFix64) {
          let lenderVault: @FlowToken.Vault
          let lendingManagerRef: &TimeLendingProtocol2.LendingManager
          let signer: Address
          
          prepare(signer: auth(BorrowValue, Storage) &Account) {
          self.signer = signer.address
              let vaultRef = signer.storage.borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(
                  from: /storage/flowTokenVault
              ) ?? panic("Could not borrow reference to the FLOW vault")
              
              self.lenderVault <- vaultRef.withdraw(amount: amount) as! @FlowToken.Vault
              self.lendingManagerRef = TimeLendingProtocol2.borrowLendingManager()
          }
          
          execute {
              let positionId = self.lendingManagerRef.createLendingPosition(
                  tokenVault: <-self.lenderVault,
                  lender: self.signer
              )
              
              log("Lending position created with ID: ".concat(positionId.toString()))
          }
      }
    `;
  } else {
    throw new Error(`Unsupported token symbol: ${tokenSymbol}. Supported tokens: ETH, WETH, USDC, FLOW`);
  }

  // Convert the JavaScript amount string/number into an FCL Argument object
  const transactionArgs = [
    fcl.arg(parseFloat(amount).toFixed(8), fcl.t.UFix64),
  ];

  // Execute the transaction
  const txId = await executeTransaction(createLendingCadence, transactionArgs);
  
  return txId;
}
