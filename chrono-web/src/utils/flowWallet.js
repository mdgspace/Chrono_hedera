import * as fcl from "@onflow/fcl"

export const configureFCL = () => {
  fcl.config({
    "accessNode.api": "https://rest-testnet.onflow.org", // Flow testnet
    "discovery.wallet": "https://fcl-discovery.onflow.org/testnet/authn", // Testnet wallet discovery
    "app.detail.title": "Chrono - Time Lending Protocol",
    "app.detail.icon": "https://placekitten.com/g/200/200",
  })
}

/**
 * Connect to Flow wallet
 * @returns {Promise<Object>} User account information
 */
export const connectWallet = async () => {
  try {

    const user = await fcl.authenticate()

    await setupLiquidationPoolHandler()
    await createWrappedUSDCVault()
    await createWrappedETHVault()

    return user
  } catch (error) {
    console.error('Failed to connect wallet or set up vault:', error)
    throw error
  }
}

export const disconnectWallet = async () => {
  try {
    await fcl.unauthenticate()
    console.log('Wallet disconnected')
  } catch (error) {
    console.error('Failed to disconnect wallet:', error)
    throw error
  }
}

/**
 * Get current user
 * @returns {Promise<Object|null>} Current user or null
 */
export const getCurrentUser = async () => {
  try {
    const user = await fcl.currentUser.snapshot()
    return user.loggedIn ? user : null
  } catch (error) {
    console.error('Failed to get current user:', error)
    return null
  }
}

/**
 * Execute a Cadence transaction
 * @param {string} code - Cadence transaction code
 * @param {Array} args - Transaction arguments
 * @returns {Promise<string>} Transaction ID
 */
export const executeTransaction = async (code, args = []) => {
  try {
    const txId = await fcl.mutate({
      cadence: code,
      // The function for args can be simplified when the array is pre-built
      args: () => args,

      // 🔑 CRITICAL FIX: These properties use the currently authenticated user (fcl.authz) 
      // to propose, pay, and authorize the transaction, which triggers the wallet.
      proposer: fcl.authz,
      payer: fcl.authz,
      authorizations: [fcl.authz],

      limit: 999
    })

    // Wait for transaction to be sealed
    const txStatus = await fcl.tx(txId).onceSealed()
    console.log('Transaction sealed:', txStatus)

    return txId
  } catch (error) {
    console.error('Transaction failed:', error)
    throw error
  }
}

/**
 * Execute a Cadence script (read-only)
 * @param {string} code - Cadence script code
 * @param {Array} args - Script arguments
 * @returns {Promise<any>} Script result
 */
export const executeScript = async (code, args = []) => {
  try {
    const result = await fcl.query({
      cadence: code,
      args: (arg, t) => args
    })
    return result
  } catch (error) {
    console.error('Script failed:', error)
    throw error
  }
}

/**
 * Subscribe to user authentication state changes
 * @param {Function} callback - Callback function to handle user state
 * @returns {Function} Unsubscribe function
 */
export const subscribeToUser = (callback) => {
  return fcl.currentUser.subscribe(callback)
}

/**
 * Get account balance
 * @param {string} address - Flow account address
 * @returns {Promise<string>} Account balance
 */
export const getAccountBalance = async (address) => {
  try {
    const balance = await executeScript(`
      import FlowToken from 0x7e60df042a9c0868
      import FungibleToken from 0x9a0766d93b6608b7
      
      access(all) fun main(address: Address): UFix64 {
        let account = getAccount(address)
        let vaultRef = account.capabilities
          .get<&FlowToken.Vault>(/public/flowTokenBalance)
          .borrow()
          ?? panic("Could not borrow Balance reference")
        return vaultRef.balance
      }
    `, [fcl.arg(address, fcl.t.Address)])

    return balance.toFixed(4)
  } catch (error) {
    console.error('Failed to fetch balance:', error)
    return '0.00'
  }
}
/**
 * Initializes the WrappedETH2 Vault on the signer's account, 
 * saving the resource to storage and publishing the public capabilities.
 * * @returns {Promise<string>} The transaction ID.
 */
export const createWrappedETHVault = async () => {
  // The complete Cadence transaction code as a string
  const setupCadence = `
       import FungibleToken from 0x9a0766d93b6608b7
import WrappedETH1 from 0xe11cab85e85ae137

// This transaction sets up an account to receive WrappedETH1 tokens
// using correct Cadence 1.0+ syntax with interface-based capabilities.

transaction {

    prepare(signer: auth(Storage, Capabilities) &Account) {
        let vault <- WrappedETH1.createEmptyVault(vaultType: Type<@WrappedETH1.Vault>())
        signer.storage.save(<-vault, to: WrappedETH1.VaultStoragePath)
        log("Created a new WrappedETH1 Vault.")

        // 2. Define receiver and balance public paths.
        let receiverPath = WrappedETH1.ReceiverPublicPath

        // 3. Unpublish any old or incorrect capabilities at those paths.
        if signer.capabilities.exists(receiverPath) {
            signer.capabilities.unpublish(receiverPath)
        }

        // 4. Issue new capabilities restricted to the appropriate interfaces.
        let receiverCapability = signer.capabilities.storage.issue<&{FungibleToken.Receiver}>(WrappedETH1.VaultStoragePath)

        // 5. Publish these capabilities to the correct public paths.
        signer.capabilities.publish(receiverCapability, at: receiverPath)

        log("Published WrappedETH1 Receiver capabilities using Cadence 1.0+ syntax.")
    }

    execute {
        log("WrappedETH1 Vault setup complete.")
    }
}
    `;

  // The transaction takes no arguments.
  // Call the utility function to execute the transaction.
  return await executeTransaction(setupCadence, []);
}
/**
 * Sets up the user's account to receive WrappedUSDC1 tokens by creating 
 * the storage vault and publishing the public Receiver capability.
 * * @returns {Promise<string>} The transaction ID.
 */
export const createWrappedUSDCVault = async () => {
  // The complete Cadence transaction code as a string
  const setupCadence = `
        import FungibleToken from 0x9a0766d93b6608b7
        import WrappedUSDC1 from 0xe11cab85e85ae137

        // This transaction sets up an account to receive WrappedUSDC1 tokens
        // using correct Cadence 1.0+ syntax with interface-based capabilities.

        transaction {

            prepare(signer: auth(Storage, Capabilities) &Account) {
                // 1. Create and save the new Vault to storage.
                let vault <- WrappedUSDC1.createEmptyVault(vaultType: Type<@WrappedUSDC1.Vault>())
                signer.storage.save(<-vault, to: WrappedUSDC1.VaultStoragePath)
                log("Created a new WrappedUSDC1 Vault.")

                // 2. Define receiver public path.
                let receiverPath = WrappedUSDC1.ReceiverPublicPath

                // 3. Unpublish any old or incorrect capabilities at that path.
                if signer.capabilities.exists(receiverPath) {
                    signer.capabilities.unpublish(receiverPath)
                }

                // 4. Issue new capabilities restricted to the appropriate interfaces.
                let receiverCapability = signer.capabilities.storage.issue<&{FungibleToken.Receiver}>(WrappedUSDC1.VaultStoragePath)

                // 5. Publish these capabilities to the correct public path.
                signer.capabilities.publish(receiverCapability, at: receiverPath)

                log("Published WrappedUSDC1 Receiver capabilities using Cadence 1.0+ syntax.")
            }

            execute {
                log("WrappedUSDC1 Vault setup complete.")
            }
        }
    `;

  // The transaction takes no arguments.
  // Call the utility function to execute the transaction.
  return await executeTransaction(setupCadence, []);
}


/**
 * Sets up the user's account to receive WrappedUSDC1 tokens by creating 
 * the storage vault and publishing the public Receiver capability.
 * @returns {Promise<string>} The transaction ID.
 */
export const setupLiquidationPoolHandler = async () => {
  // The complete Cadence transaction code as a string
  const setupCadence = `
    import LiquidationPoolTransactionHandler from 0xe11cab85e85ae137
import FlowTransactionScheduler from 0x8c5303eaa26202d6

transaction() {
    prepare(signer: auth(BorrowValue, IssueStorageCapabilityController, SaveValue, PublishCapability) &Account) {
        // Save a handler resource to storage if not already present
        if signer.storage.borrow<&AnyResource>(from: /storage/LiquidationPoolTransactionHandler) == nil {
            let handler <- LiquidationPoolTransactionHandler.createHandler()
            signer.storage.save(<-handler, to: /storage/LiquidationPoolTransactionHandler)
        }

        // Validation/example that we can create an issue a handler capability with correct entitlement for FlowTransactionScheduler
        let _ = signer.capabilities.storage
            .issue<auth(FlowTransactionScheduler.Execute) &{FlowTransactionScheduler.TransactionHandler}>(/storage/LiquidationPoolTransactionHandler)
    
        // Issue a non-entitled public capability for the handler that is publicly accessible
        let publicCap = signer.capabilities.storage
            .issue<&{FlowTransactionScheduler.TransactionHandler}>(/storage/LiquidationPoolTransactionHandler)
        // publish the capability
        signer.capabilities.publish(publicCap, at: /public/LiquidationPoolTransactionHandler)
    }
}
       
    `;

  // The transaction takes no arguments.
  // Call the utility function to execute the transaction.
  return await executeTransaction(setupCadence, []);
}
