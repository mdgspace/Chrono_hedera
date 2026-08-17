import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { addLiquidityUSDC } from '../utils/add-liquidity-usdc'
import { useCountUp } from '../hooks/useCountUp'

export default function PoolDetailView({ pool, onBack, isWalletConnected, onConnect, userAddress }) {
  const [amount, setAmount] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [txStatus, setTxStatus] = useState(null)
  const [startAnimation, setStartAnimation] = useState(false)

  // Trigger animation when component mounts
  useEffect(() => {
    setStartAnimation(true)
  }, [])

  // Format functions for count-up
  const formatNumber = (value) => {
    // Try to preserve original format if pool data has decimals
    if (value >= 1000) {
      return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    }
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const formatCurrency = (value) => {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const formatInteger = (value) => {
    return Math.floor(value).toLocaleString('en-US')
  }

  // Extract numeric values
  const extractNumericValue = (val) => {
    if (typeof val === 'number') return val
    if (typeof val === 'string') {
      // Remove currency symbols, commas, and parse
      const cleaned = val.replace(/[$,\s]/g, '')
      const num = parseFloat(cleaned)
      return isNaN(num) ? 0 : num
    }
    return 0
  }

  const totalShares = extractNumericValue(pool?.totalShares || 0)
  const usdcLiquidity = extractNumericValue(pool?.totalUSDCLiquidity || 0)
  const contributors = extractNumericValue(pool?.totalContributors || 0)

  // Animated values (1.5x faster: 1333ms)
  const animatedTotalShares = useCountUp(
    totalShares,
    1333,
    formatNumber,
    startAnimation
  )

  const animatedUSDCLiquidity = useCountUp(
    usdcLiquidity,
    1333,
    formatCurrency,
    startAnimation
  )

  const animatedContributors = useCountUp(
    contributors,
    1333,
    formatInteger,
    startAnimation
  )

  const handleAddLiquidity = async () => {
    const val = parseFloat(amount)
    if (!val || val <= 0) return
    try {
      setIsSubmitting(true)
      setTxStatus(null)
      const txId = await addLiquidityUSDC(val)
      setTxStatus({ type: 'success', txId, amount: val })
      setAmount('')
    } catch (e) {
      setTxStatus({ type: 'error', message: e?.message || 'Transaction failed' })
    } finally {
      setIsSubmitting(false)
    }
  }

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
          Back to Pools
        </motion.button>

        <motion.div
          className="mb-6 md:mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-neutral-800 border-2 border-neutral-950 flex items-center justify-center text-white font-bold text-lg md:text-xl flex-shrink-0">
              P
            </div>
            <div>
              <div className="text-xs text-gray-500">Liquidation Pool</div>
              <h1 className="text-2xl md:text-4xl font-bold text-white">USDC Pool</h1>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 md:gap-8">
            <div>
              <div className="text-gray-500 text-xs md:text-sm mb-1">Total shares</div>
              <div className="text-lg md:text-3xl font-bold text-white">
                {startAnimation && totalShares > 0 ? animatedTotalShares : (pool?.totalShares || '—')}
              </div>
            </div>
            <div>
              <div className="text-gray-500 text-xs md:text-sm mb-1">USDC liquidity</div>
              <div className="text-lg md:text-3xl font-bold text-white">
                {startAnimation && usdcLiquidity > 0 ? animatedUSDCLiquidity : (pool?.totalUSDCLiquidity || '—')}
              </div>
            </div>
            <div>
              <div className="text-gray-500 text-xs md:text-sm mb-1">Contributors</div>
              <div className="text-lg md:text-3xl font-bold text-white">
                {startAnimation && contributors > 0 ? animatedContributors : (pool?.totalContributors || '—')}
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
              <h3 className="text-lg md:text-xl font-bold text-white mb-4 md:mb-6">Overview</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
                <div>
                  <div className="text-xs text-gray-500 mb-2">ETH liquidity</div>
                  <div className="text-lg font-semibold text-white">{pool?.totalETHLiquidity || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-2">FLOW liquidity</div>
                  <div className="text-lg font-semibold text-white">{pool?.totalFlowLiquidity || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-2">Pending FLOW rewards</div>
                  <span className="text-sm font-medium text-white">{pool?.pendingFlowRewards || '—'}</span>
                </div>
              </div>
            </motion.div>

            <motion.div
              className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 md:p-6"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.3 }}
            >
              <h3 className="text-lg md:text-xl font-bold text-white mb-4 md:mb-6">Collateral waiting</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
                <div>
                  <div className="text-xs text-gray-500 mb-2">Collateral ETH</div>
                  <div className="text-xl font-bold text-white">{pool?.collateralETHBalance || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-2">Collateral USDC</div>
                  <div className="text-xl font-bold text-white">{pool?.collateralUSDCBalance || '—'}</div>
                </div>
              </div>
            </motion.div>
          </div>

          <div className="lg:sticky lg:top-8 h-fit">
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 md:p-6">
              <h3 className="text-base md:text-lg font-semibold text-white mb-4 md:mb-6">Add USDC Liquidity</h3>

              {txStatus && (
                <div
                  role="status"
                  aria-live="polite"
                  className={`mb-4 rounded-lg px-3 py-2 text-sm border overflow-hidden ${
                    txStatus.type === 'success'
                      ? 'bg-[#c5ff4a]/10 border-[#c5ff4a] text-[#c5ff4a]'
                      : 'bg-red-900/20 border-red-700 text-red-300'
                  }`}
                >
                  {txStatus.type === 'success' ? (
                    <div>
                      <div className="font-medium">Successfully added {txStatus.amount} USDC</div>
                      {txStatus.txId && (
                        <div className="mt-1 text-xs text-inherit font-mono break-all">tx: {txStatus.txId}</div>
                      )}
                    </div>
                  ) : (
                    <div className="break-words">{txStatus.message}</div>
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
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-4 text-white text-2xl font-bold focus:outline-none focus:border-neutral-600"
                  disabled={!isWalletConnected}
                />
              </div>

              {isWalletConnected ? (
                <button
                  onClick={handleAddLiquidity}
                  disabled={isSubmitting || !amount || parseFloat(amount) <= 0}
                  aria-busy={isSubmitting ? 'true' : 'false'}
                  aria-live="polite"
                  className={`w-full font-semibold py-3 rounded-lg transition-colors ${
                    isSubmitting || !amount || parseFloat(amount) <= 0
                      ? 'bg-neutral-700 text-gray-500 cursor-not-allowed'
                      : 'bg-[#c5ff4a] hover:bg-[#b0e641] text-neutral-900'
                  }`}
                >
                  {isSubmitting ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <span className="inline-block w-4 h-4 rounded-full border-2 border-[#c5ff4a] border-t-transparent animate-spin"></span>
                      Adding…
                    </span>
                  ) : (
                    'Add Liquidity'
                  )}
                </button>
              ) : (
                <button onClick={onConnect} className="w-full font-semibold py-3 rounded-lg bg-[#c5ff4a] hover:bg-[#b0e641] text-neutral-900">Connect Wallet</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}


