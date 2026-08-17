import { useState } from 'react'
import { motion } from 'framer-motion'
import * as fcl from '@onflow/fcl'

export default function FaucetView({ isWalletConnected, onConnect, userAddress }) {
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('') // 'success' or 'error'

  const handleClaimWETH = async () => {
    if (!isWalletConnected) {
      setMessage('Please connect your wallet first')
      setMessageType('error')
      return
    }

    setIsLoading(true)
    setMessage('Processing your request...')
    setMessageType('')

    try {
      const user = await fcl.currentUser.snapshot()
      const fullAddress = user?.addr
      
      if (!fullAddress) {
        throw new Error('Could not get user address')
      }

      console.log('Requesting 100 WETH for address:', fullAddress)

      const response = await fetch('http://localhost:3001/api/faucet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          address: fullAddress
        })
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setMessage(`Success! You received 100 WETH. Transaction ID: ${data.transactionId}`)
        setMessageType('success')
      } else {
        setMessage(data.error || 'Failed to claim WETH')
        setMessageType('error')
      }
    } catch (error) {
      console.error('Faucet claim error:', error)
      setMessage(`Error: ${error.message}`)
      setMessageType('error')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <motion.div
      className="min-h-[calc(100vh-200px)] flex items-center justify-center"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
    >
      <div className="w-full max-w-2xl">
        <motion.div
          className="bg-neutral-900 border border-neutral-800 rounded-2xl p-8 md:p-12"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-[#c5ff4a]/10 rounded-full mb-4">
              <svg 
                className="w-10 h-10 text-[#c5ff4a]" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
                />
              </svg>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
              WETH Faucet
            </h1>
            <p className="text-gray-400 text-lg">
              Get 100 WETH to test the Chrono Protocol on testnet
            </p>
          </div>

          <div className="bg-neutral-800/50 border border-neutral-700 rounded-xl p-6 mb-8">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0">
                <svg 
                  className="w-6 h-6 text-[#c5ff4a]" 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth={2} 
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
                  />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-white font-semibold mb-2">About the Faucet</h3>
                <ul className="text-gray-400 text-sm space-y-2">
                  <li>• Receive 100 WETH (Wrapped ETH) for testing</li>
                  <li>• Available on Flow Testnet only</li>
                  <li>• Use these tokens to test lending and borrowing</li>
                  <li>• Connect your wallet to claim tokens</li>
                </ul>
              </div>
            </div>
          </div>

          {isWalletConnected && userAddress && (
            <div className="bg-neutral-800 border border-neutral-700 rounded-xl p-4 mb-6">
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-sm">Connected Wallet</span>
                <span className="text-white font-mono text-sm">{userAddress}</span>
              </div>
            </div>
          )}

          <motion.button
            onClick={isWalletConnected ? handleClaimWETH : onConnect}
            disabled={isLoading}
            className={`w-full py-4 rounded-xl font-semibold text-lg transition-all duration-200 ${
              isLoading
                ? 'bg-neutral-700 text-gray-400 cursor-not-allowed'
                : 'bg-[#c5ff4a] hover:bg-[#b0e641] text-neutral-900'
            }`}
            whileHover={!isLoading ? { scale: 1.02 } : {}}
            whileTap={!isLoading ? { scale: 0.98 } : {}}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-3">
                <svg 
                  className="animate-spin h-5 w-5" 
                  xmlns="http://www.w3.org/2000/svg" 
                  fill="none" 
                  viewBox="0 0 24 24"
                >
                  <circle 
                    className="opacity-25" 
                    cx="12" 
                    cy="12" 
                    r="10" 
                    stroke="currentColor" 
                    strokeWidth="4"
                  />
                  <path 
                    className="opacity-75" 
                    fill="currentColor" 
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Processing...
              </span>
            ) : isWalletConnected ? (
              'Claim 100 WETH'
            ) : (
              'Connect Wallet'
            )}
          </motion.button>

          {message && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mt-6 p-4 rounded-xl border ${
                messageType === 'success'
                  ? 'bg-green-900/20 border-green-700 text-green-300'
                  : messageType === 'error'
                  ? 'bg-red-900/20 border-red-700 text-red-300'
                  : 'bg-blue-900/20 border-blue-700 text-blue-300'
              }`}
            >
              <p className="text-sm break-words">{message}</p>
            </motion.div>
          )}

          <div className="mt-8 pt-6 border-t border-neutral-800">
            <p className="text-gray-500 text-sm text-center">
              Having issues? Make sure you're connected to Flow Testnet
            </p>
          </div>
        </motion.div>
      </div>
    </motion.div>
  )
}








