import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { withdrawLending } from '../utils/withdraw-lending'
import { formatTokenAmount, formatTimestamp } from '../utils/portfolioData'
import { useCountUp } from '../hooks/useCountUp'

export default function LendingPositionDetailsView({
  position,
  onBack,
  isWalletConnected,
  onConnect,
  userAddress,
  onActionSuccess
}) {
  const [isWithdrawing, setIsWithdrawing] = useState(false)
  const [withdrawTxStatus, setWithdrawTxStatus] = useState(null)
  const [startAnimation, setStartAnimation] = useState(false)
  const [animationComplete, setAnimationComplete] = useState(false)

  const handleWithdraw = async () => {
    if (!position.isActive) return
    try {
      setIsWithdrawing(true)
      setWithdrawTxStatus(null)
      const txId = await withdrawLending(position.id)
      setWithdrawTxStatus({ type: 'success', message: 'Successfully withdrawn lending position', txId })
      
      if (onActionSuccess) {
        await onActionSuccess()
      }
    } catch (error) {
      setWithdrawTxStatus({
        type: 'error',
        message: error?.message ? `Withdraw failed: ${error.message}` : 'Withdraw failed. Please try again.'
      })
    } finally {
      setIsWithdrawing(false)
    }
  }

  // Calculate time since position was created - capture initial value for animation
  const ts = position.timestamp ? parseFloat(position.timestamp) : 0
  const [initialTimeActiveHours] = useState(() => {
    const nowSec = Math.floor(Date.now() / 1000)
    const timeElapsed = ts > 0 ? nowSec - ts : 0
    return timeElapsed > 0 ? timeElapsed / 3600 : 0
  })

  // Calculate current time elapsed for display (updates on re-render)
  const nowSec = Math.floor(Date.now() / 1000)
  const timeElapsed = ts > 0 ? nowSec - ts : 0
  const daysElapsed = timeElapsed > 0 ? Math.floor(timeElapsed / 86400) : 0
  const hoursElapsed = timeElapsed > 0 ? Math.floor((timeElapsed % 86400) / 3600) : 0

  // Trigger animation when component mounts
  useEffect(() => {
    setStartAnimation(true)
    // Mark animation as complete after duration
    const timer = setTimeout(() => {
      setAnimationComplete(true)
    }, 1333)
    return () => clearTimeout(timer)
  }, [])

  // Format functions for count-up
  const formatNumber = (value) => {
    return value.toFixed(8)
  }

  const formatTimeActive = (value) => {
    // value is in hours, convert appropriately
    if (value < 1) {
      // If less than 1 hour, show minutes
      const minutes = Math.floor(value * 60)
      if (minutes <= 0) {
        return '0m'
      }
      return `${minutes}m`
    }
    
    const days = Math.floor(value / 24)
    const hours = Math.floor(value % 24)
    
    if (days > 0) {
      return `${days}d ${hours}h`
    } else {
      return `${hours}h`
    }
  }

  // Extract numeric values
  const lentAmount = parseFloat(position.amount) || 0

  // Animated values (1.5x faster: 1333ms) - use initial captured value
  const animatedLentAmount = useCountUp(
    lentAmount,
    1333,
    formatNumber,
    startAnimation
  )

  const animatedTimeActive = useCountUp(
    initialTimeActiveHours,
    1333,
    formatTimeActive,
    startAnimation
  )

  return (
    <motion.div
      className="min-h-screen bg-neutral-950 pt-4 md:pt-8"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
    >
      <div className="container mx-auto px-4">
        <motion.button
          onClick={onBack}
          className="mb-4 md:mb-6 text-gray-400 hover:text-white flex items-center gap-2 transition-colors"
          whileHover={{ x: -4 }}
          whileTap={{ scale: 0.95 }}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Portfolio
        </motion.button>

        <motion.div
          className="mb-6 md:mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-neutral-800 border-2 border-neutral-950 flex items-center justify-center text-white font-bold text-lg md:text-xl flex-shrink-0">
              {position.token?.substring(0, 1) || '?'}
            </div>
            <div>
              <div className="text-xs text-gray-500">Position #{position.id}</div>
              <h1 className="text-2xl md:text-4xl font-bold text-white">
                {position.token || '—'}
              </h1>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-8">
            <div>
              <div className="text-gray-500 text-xs md:text-sm mb-1">Lent Amount</div>
              <div className="text-lg md:text-3xl font-bold text-white">
                {startAnimation ? animatedLentAmount : formatTokenAmount(position.amount)}
              </div>
              <div className="text-xs text-gray-500">{position.token || '—'}</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs md:text-sm mb-1">Status</div>
              <div className="mt-2">
                <span className={`px-3 py-1.5 rounded text-sm font-medium ${
                  position.isActive 
                    ? 'bg-green-900/30 text-green-400 border border-green-700/50' 
                    : 'bg-gray-900/30 text-gray-400 border border-gray-700/50'
                }`}>
                  {position.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
            <div>
              <div className="text-gray-500 text-xs md:text-sm mb-1">Time Active</div>
              <div className="text-lg md:text-3xl font-bold text-white">
                {startAnimation && !animationComplete
                  ? animatedTimeActive
                  : (() => {
                      const minutes = timeElapsed > 0 ? Math.floor((timeElapsed % 3600) / 60) : 0
                      if (daysElapsed > 0) {
                        return `${daysElapsed}d ${hoursElapsed}h`
                      } else if (hoursElapsed > 0) {
                        return `${hoursElapsed}h`
                      } else if (minutes > 0) {
                        return `${minutes}m`
                      } else {
                        return '0m'
                      }
                    })()}
              </div>
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <motion.div
              className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 md:p-6"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.2 }}
            >
              <h3 className="text-lg md:text-xl font-bold text-white mb-4 md:mb-6">Position Details</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
                <div>
                  <div className="text-xs text-gray-500 mb-2">Position ID</div>
                  <div className="text-lg font-semibold text-white">#{position.id}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-2">Token</div>
                  <div className="text-lg font-semibold text-white">{position.token || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-2">Amount</div>
                  <div className="text-lg font-semibold text-white">
                    {formatTokenAmount(position.amount)} {position.token || ''}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-2">Status</div>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    position.isActive 
                      ? 'bg-green-900/30 text-green-400 border border-green-700/50' 
                      : 'bg-gray-900/30 text-gray-400 border border-gray-700/50'
                  }`}>
                    {position.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-2">Opened</div>
                  <div className="text-lg font-semibold text-white">
                    {formatTimestamp(position.timestamp)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-2">Time Active</div>
                  <div className="text-lg font-semibold text-white">
                    {(() => {
                      const minutes = timeElapsed > 0 ? Math.floor((timeElapsed % 3600) / 60) : 0
                      if (daysElapsed > 0) {
                        return `${daysElapsed}d ${hoursElapsed}h`
                      } else if (hoursElapsed > 0) {
                        return `${hoursElapsed}h`
                      } else if (minutes > 0) {
                        return `${minutes}m`
                      } else {
                        return '0m'
                      }
                    })()}
                  </div>
                </div>
              </div>
            </motion.div>

            <motion.div
              className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 md:p-6"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.3 }}
            >
              <h3 className="text-lg md:text-xl font-bold text-white mb-4 md:mb-6">Position Summary</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center py-3 border-b border-neutral-700">
                  <span className="text-gray-400">Lent Amount</span>
                  <span className="text-white font-semibold text-lg">
                    {formatTokenAmount(position.amount)} {position.token || ''}
                  </span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-neutral-700">
                  <span className="text-gray-400">Status</span>
                  <span className={`px-3 py-1 rounded text-sm font-medium ${
                    position.isActive 
                      ? 'bg-green-900/30 text-green-400 border border-green-700/50' 
                      : 'bg-gray-900/30 text-gray-400 border border-gray-700/50'
                  }`}>
                    {position.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="flex justify-between items-center py-3">
                  <span className="text-gray-400">Position Duration</span>
                  <span className="text-white font-semibold">
                    {(() => {
                      const minutes = timeElapsed > 0 ? Math.floor((timeElapsed % 3600) / 60) : 0
                      if (daysElapsed > 0) {
                        return `${daysElapsed} day${daysElapsed !== 1 ? 's' : ''} ${hoursElapsed} hour${hoursElapsed !== 1 ? 's' : ''}`
                      } else if (hoursElapsed > 0) {
                        return `${hoursElapsed} hour${hoursElapsed !== 1 ? 's' : ''}`
                      } else if (minutes > 0) {
                        return `${minutes} minute${minutes !== 1 ? 's' : ''}`
                      } else {
                        return '0 minutes'
                      }
                    })()}
                  </span>
                </div>
              </div>
            </motion.div>
          </div>

          <div className="lg:sticky lg:top-8 h-fit">
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 md:p-6">
              <h3 className="text-base md:text-lg font-semibold text-white mb-4 md:mb-6">
                Withdraw Position
              </h3>

              {withdrawTxStatus && (
                <div
                  role="status"
                  aria-live="polite"
                  className={`mb-4 rounded-lg px-3 py-2 text-sm border overflow-hidden ${
                    withdrawTxStatus.type === 'success'
                      ? 'bg-[#c5ff4a]/10 border-[#c5ff4a] text-[#c5ff4a]'
                      : 'bg-red-900/20 border-red-700 text-red-300'
                  }`}
                >
                  {withdrawTxStatus.type === 'success' ? (
                    <div>
                      <div className="font-medium">{withdrawTxStatus.message}</div>
                      {withdrawTxStatus.txId && (
                        <div className="mt-1 text-xs text-inherit font-mono break-all">
                          tx: {withdrawTxStatus.txId}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="break-words">{withdrawTxStatus.message}</div>
                  )}
                </div>
              )}

              {isWalletConnected && (
                <div className="flex justify-between items-center text-xs mb-3">
                  <span className="text-gray-500">Connected Wallet</span>
                  <span className="text-[#c5ff4a] font-mono">{userAddress}</span>
                </div>
              )}

              <div className="mb-6 p-4 bg-neutral-800 rounded-lg border border-neutral-700">
                <div className="text-xs text-gray-500 mb-2">Withdrawable Amount</div>
                <div className="text-2xl font-bold text-white">
                  {formatTokenAmount(position.amount)} {position.token || ''}
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  This includes your deposited amount plus any earned interest
                </div>
              </div>

              <div className="space-y-3 mb-6 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Current Balance</span>
                  <span className="text-white font-medium">
                    {formatTokenAmount(position.amount)} {position.token || ''}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Estimated gas fee</span>
                  <span className="text-white font-medium">0 FLOW <span className="text-gray-500">$0</span></span>
                </div>
              </div>

              {isWalletConnected ? (
                <button
                  onClick={handleWithdraw}
                  disabled={isWithdrawing || !position.isActive}
                  aria-busy={isWithdrawing ? 'true' : 'false'}
                  className={`w-full font-semibold py-3 rounded-lg transition-colors ${
                    isWithdrawing || !position.isActive
                      ? 'bg-neutral-700 text-gray-500 cursor-not-allowed'
                      : 'bg-[#c5ff4a] hover:bg-[#b0e641] text-neutral-900'
                  }`}
                >
                  {isWithdrawing ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <span className="inline-block w-4 h-4 rounded-full border-2 border-neutral-900 border-t-transparent animate-spin"></span>
                      Withdrawing…
                    </span>
                  ) : (
                    'Withdraw'
                  )}
                </button>
              ) : (
                <button
                  onClick={onConnect}
                  className="w-full font-semibold py-3 rounded-lg bg-[#c5ff4a] hover:bg-[#b0e641] text-neutral-900"
                >
                  Connect Wallet
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}



