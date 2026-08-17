import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { repayLoan } from '../utils/repay-loan'
import { borrowMore } from '../utils/borrow-more'
import { formatTokenAmount, formatTimestamp } from '../utils/portfolioData'
import { useCountUp } from '../hooks/useCountUp'

export default function BorrowPositionDetailsView({
  position,
  onBack,
  isWalletConnected,
  onConnect,
  userAddress,
  onActionSuccess
}) {
  const [additionalBorrowAmount, setAdditionalBorrowAmount] = useState('')
  const [isRepaying, setIsRepaying] = useState(false)
  const [isBorrowingMore, setIsBorrowingMore] = useState(false)
  const [repayTxStatus, setRepayTxStatus] = useState(null)
  const [borrowMoreTxStatus, setBorrowMoreTxStatus] = useState(null)
  const [startAnimation, setStartAnimation] = useState(false)

  const handleRepay = async () => {
    if (!position.isActive) return
    try {
      setIsRepaying(true)
      setRepayTxStatus(null)
      const txId = await repayLoan(position.id)
      setRepayTxStatus({ type: 'success', message: 'Successfully repaid loan', txId })
      
      if (onActionSuccess) {
        await onActionSuccess()
      }
    } catch (error) {
      setRepayTxStatus({
        type: 'error',
        message: error?.message ? `Repay failed: ${error.message}` : 'Repay failed. Please try again.'
      })
    } finally {
      setIsRepaying(false)
    }
  }

  const handleBorrowMore = async () => {
    const amount = parseFloat(additionalBorrowAmount)
    if (!amount || amount <= 0) return
    if (!position.isActive) return
    
    try {
      setIsBorrowingMore(true)
      setBorrowMoreTxStatus(null)
      const txId = await borrowMore(position.id, additionalBorrowAmount)
      setBorrowMoreTxStatus({ type: 'success', message: `Successfully borrowed additional ${amount} ${position.borrowTokenType}`, txId })
      setAdditionalBorrowAmount('')
      
      if (onActionSuccess) {
        await onActionSuccess()
      }
    } catch (error) {
      setBorrowMoreTxStatus({
        type: 'error',
        message: error?.message ? `Borrow more failed: ${error.message}` : 'Borrow more failed. Please try again.'
      })
    } finally {
      setIsBorrowingMore(false)
    }
  }

  const ltvPercent = position.calculatedLTV ? (parseFloat(position.calculatedLTV) * 100).toFixed(2) : '0'
  const healthFactor = position.healthFactor ? parseFloat(position.healthFactor).toFixed(2) : '—'
  const healthFactorColor = position.healthFactor 
    ? parseFloat(position.healthFactor) > 1.5 
      ? 'text-green-400' 
      : parseFloat(position.healthFactor) > 1.0 
        ? 'text-yellow-400' 
        : 'text-red-400'
    : 'text-gray-400'

  // Trigger animation when component mounts
  useEffect(() => {
    setStartAnimation(true)
  }, [])

  // Format functions for count-up
  const formatNumber = (value) => {
    return value.toFixed(8)
  }

  const formatPercentage = (value) => {
    return `${value.toFixed(2)}%`
  }

  const formatHealthFactor = (value) => {
    return value.toFixed(2)
  }

  // Extract numeric values
  const collateralAmount = parseFloat(position.collateralAmount) || 0
  const borrowAmount = parseFloat(position.borrowAmount) || 0
  const ltvValue = parseFloat(ltvPercent) || 0
  const healthFactorValue = position.healthFactor ? parseFloat(position.healthFactor) : 0

  // Animated values (1.5x faster: 1333ms)
  const animatedCollateral = useCountUp(
    collateralAmount,
    1333,
    formatNumber,
    startAnimation
  )

  const animatedBorrowed = useCountUp(
    borrowAmount,
    1333,
    formatNumber,
    startAnimation
  )

  const animatedLTV = useCountUp(
    ltvValue,
    1333,
    formatPercentage,
    startAnimation
  )

  const animatedHealthFactor = useCountUp(
    healthFactorValue,
    1333,
    formatHealthFactor,
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
              {position.collateralType?.substring(0, 1) || '?'}
            </div>
            <div>
              <div className="text-xs text-gray-500">Position #{position.id}</div>
              <h1 className="text-2xl md:text-4xl font-bold text-white">
                {position.collateralType || '—'} / {position.borrowTokenType || '—'}
              </h1>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-8">
            <div>
              <div className="text-gray-500 text-xs md:text-sm mb-1">Collateral</div>
              <div className="text-lg md:text-3xl font-bold text-white">
                {startAnimation ? animatedCollateral : formatTokenAmount(position.collateralAmount)}
              </div>
              <div className="text-xs text-gray-500">{position.collateralType || '—'}</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs md:text-sm mb-1">Borrowed</div>
              <div className="text-lg md:text-3xl font-bold text-white">
                {startAnimation ? animatedBorrowed : formatTokenAmount(position.borrowAmount)}
              </div>
              <div className="text-xs text-gray-500">{position.borrowTokenType || '—'}</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs md:text-sm mb-1">LTV</div>
              <div className="text-lg md:text-3xl font-bold text-white">
                {startAnimation ? animatedLTV : `${ltvPercent}%`}
              </div>
            </div>
            <div>
              <div className="text-gray-500 text-xs md:text-sm mb-1">Health Factor</div>
              <div className={`text-lg md:text-3xl font-bold ${healthFactorColor}`}>
                {startAnimation && healthFactorValue > 0 ? animatedHealthFactor : healthFactor}
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
                  <div className="text-xs text-gray-500 mb-2">Duration</div>
                  <div className="text-lg font-semibold text-white">
                    {position.durationMinutes ? `${position.durationMinutes} min` : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-2">Repayment Deadline</div>
                  <div className="text-lg font-semibold text-white">
                    {position.repaymentDeadline ? formatTimestamp(position.repaymentDeadline) : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-2">Opened</div>
                  <div className="text-lg font-semibold text-white">
                    {formatTimestamp(position.timestamp)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-2">Liquidation Threshold</div>
                  <div className="text-lg font-semibold text-white">
                    {position.liquidationThreshold ? `${(parseFloat(position.liquidationThreshold) * 100).toFixed(2)}%` : '—'}
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
              <h3 className="text-lg md:text-xl font-bold text-white mb-4 md:mb-6">Position Metrics</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
                <div>
                  <div className="text-xs text-gray-500 mb-2">Current LTV</div>
                  <div className="text-xl font-bold text-white">{ltvPercent}%</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-2">Health Factor</div>
                  <div className={`text-xl font-bold ${healthFactorColor}`}>{healthFactor}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-2">Max LTV</div>
                  <div className="text-xl font-bold text-white">{ltvPercent}%</div>
                </div>
              </div>
            </motion.div>
          </div>

          <div className="lg:sticky lg:top-8 h-fit space-y-6">
            {/* Repay Section */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 md:p-6">
              <h3 className="text-base md:text-lg font-semibold text-white mb-4 md:mb-6">
                Repay Loan
              </h3>

              {repayTxStatus && (
                <div
                  role="status"
                  aria-live="polite"
                  className={`mb-4 rounded-lg px-3 py-2 text-sm border overflow-hidden ${
                    repayTxStatus.type === 'success'
                      ? 'bg-[#c5ff4a]/10 border-[#c5ff4a] text-[#c5ff4a]'
                      : 'bg-red-900/20 border-red-700 text-red-300'
                  }`}
                >
                  {repayTxStatus.type === 'success' ? (
                    <div>
                      <div className="font-medium">{repayTxStatus.message}</div>
                      {repayTxStatus.txId && (
                        <div className="mt-1 text-xs text-inherit font-mono break-all">
                          tx: {repayTxStatus.txId}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="break-words">{repayTxStatus.message}</div>
                  )}
                </div>
              )}

              {isWalletConnected && (
                <div className="flex justify-between items-center text-xs mb-3">
                  <span className="text-gray-500">Connected Wallet</span>
                  <span className="text-[#c5ff4a] font-mono">{userAddress}</span>
                </div>
              )}

              {isWalletConnected ? (
                <button
                  onClick={handleRepay}
                  disabled={isRepaying || !position.isActive}
                  aria-busy={isRepaying ? 'true' : 'false'}
                  className={`w-full font-semibold py-3 rounded-lg transition-colors ${
                    isRepaying || !position.isActive
                      ? 'bg-neutral-700 text-gray-500 cursor-not-allowed'
                      : 'bg-[#c5ff4a] hover:bg-[#b0e641] text-neutral-900'
                  }`}
                >
                  {isRepaying ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <span className="inline-block w-4 h-4 rounded-full border-2 border-neutral-900 border-t-transparent animate-spin"></span>
                      Repaying…
                    </span>
                  ) : (
                    'Repay'
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

            {/* Borrow More Section */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 md:p-6">
              <h3 className="text-base md:text-lg font-semibold text-white mb-4 md:mb-6">
                Borrow More
              </h3>

              {borrowMoreTxStatus && (
                <div
                  role="status"
                  aria-live="polite"
                  className={`mb-4 rounded-lg px-3 py-2 text-sm border overflow-hidden ${
                    borrowMoreTxStatus.type === 'success'
                      ? 'bg-[#c5ff4a]/10 border-[#c5ff4a] text-[#c5ff4a]'
                      : 'bg-red-900/20 border-red-700 text-red-300'
                  }`}
                >
                  {borrowMoreTxStatus.type === 'success' ? (
                    <div>
                      <div className="font-medium">{borrowMoreTxStatus.message}</div>
                      {borrowMoreTxStatus.txId && (
                        <div className="mt-1 text-xs text-inherit font-mono break-all">
                          tx: {borrowMoreTxStatus.txId}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="break-words">{borrowMoreTxStatus.message}</div>
                  )}
                </div>
              )}

              {isWalletConnected && (
                <div className="flex justify-between items-center text-xs mb-3">
                  <span className="text-gray-500">Connected Wallet</span>
                  <span className="text-[#c5ff4a] font-mono">{userAddress}</span>
                </div>
              )}

              <div className="mb-6">
                <input
                  type="number"
                  value={additionalBorrowAmount}
                  onChange={(e) => setAdditionalBorrowAmount(e.target.value)}
                  placeholder="0"
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-4 text-white text-2xl font-bold focus:outline-none focus:border-neutral-600"
                  disabled={!isWalletConnected || !position.isActive}
                />
                <div className="text-xs text-gray-500 mt-2">
                  Additional {position.borrowTokenType || 'tokens'} to borrow
                </div>
              </div>

              <div className="space-y-3 mb-6 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Current Borrow</span>
                  <span className="text-white font-medium">
                    {formatTokenAmount(position.borrowAmount)} {position.borrowTokenType || ''}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Estimated gas fee</span>
                  <span className="text-white font-medium">0 FLOW <span className="text-gray-500">$0</span></span>
                </div>
              </div>

              {isWalletConnected ? (
                <button
                  onClick={handleBorrowMore}
                  disabled={isBorrowingMore || !additionalBorrowAmount || parseFloat(additionalBorrowAmount) <= 0 || !position.isActive}
                  aria-busy={isBorrowingMore ? 'true' : 'false'}
                  className={`w-full font-semibold py-3 rounded-lg transition-colors ${
                    isBorrowingMore || !additionalBorrowAmount || parseFloat(additionalBorrowAmount) <= 0 || !position.isActive
                      ? 'bg-neutral-700 text-gray-500 cursor-not-allowed'
                      : 'bg-[#c5ff4a] hover:bg-[#b0e641] text-neutral-900'
                  }`}
                >
                  {isBorrowingMore ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <span className="inline-block w-4 h-4 rounded-full border-2 border-neutral-900 border-t-transparent animate-spin"></span>
                      Borrowing…
                    </span>
                  ) : (
                    'Borrow More'
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

