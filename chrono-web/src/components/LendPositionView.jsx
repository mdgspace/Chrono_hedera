import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import IRMGraph from './IRMGraph'
import { createLendingPosition } from '../utils/lending-transaction-eth'
import { useCountUp } from '../hooks/useCountUp'

export default function LendPositionView({
  asset,
  onBack,
  isWalletConnected,
  onConnect,
  userAddress,
  onSupplySuccess
}) {
  const [supplyAmount, setSupplyAmount] = useState('')
  const [isSupplying, setIsSupplying] = useState(false)
  const [txStatus, setTxStatus] = useState(null)
  const [startAnimation, setStartAnimation] = useState(false)
  
  const vaultData = {
    totalSupply: asset.totalSupply || 'not coming',
    totalSupplyTokens: asset.totalSupplyToken || '—',
    supplyAPY: asset.supplyAPY || 'not coming',
    utilization: asset.utilization || 'not coming',
    totalBorrowed: asset.totalBorrowed || 'not coming',
    totalBorrowedToken: asset.totalBorrowedToken || '—',
    availableLiquidity: asset.availableLiquidity || '—',
    availableLiquidityToken: asset.availableLiquidityToken || '—',
    borrowAPY: asset.borrowAPY || 'not coming',
    oraclePrice: asset.price || '—',
    market: asset.protocol || 'not coming',
    vaultType: asset.vaultType || 'Isolated',
    canBeBorrowed: asset.canBeBorrowed || 'not coming',
    canBeUsedAsCollateral: asset.canBeUsedAsCollateral || 'not coming',
    liquidationPenalty: asset.liquidationPenalty || 'not coming',
    supplyCap: asset.supplyCap || 'not coming',
    supplyCapPercent: asset.supplyCapPercent || 'not coming',
    borrowCap: asset.borrowCap || 'not coming',
    borrowCapPercent: asset.borrowCapPercent || 'not coming',
    shareTokenRate: asset.shareTokenRate || 'not coming',
    badDebtSocialization: asset.badDebtSocialization || 'not coming',
    interestFee: asset.interestFee || 'not coming'
  }

  const utilizationPct = parseFloat((asset.utilization || '').toString().replace('%', '')) || 0
  const radius = 16
  const circumference = 2 * Math.PI * radius

  // Trigger animation when component mounts
  useEffect(() => {
    setStartAnimation(true)
  }, [])

  // Format functions for count-up
  const formatCurrency = (value) => {
    if (typeof vaultData.totalSupply === 'string' && vaultData.totalSupply.includes('$')) {
      return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const formatPercentage = (value) => {
    return `${value.toFixed(2)}%`
  }

  // Animated values (1.5x faster: 2000ms / 1.5 = 1333ms)
  const animatedTotalSupply = useCountUp(
    vaultData.totalSupply !== 'not coming' ? vaultData.totalSupply : 0,
    1333,
    formatCurrency,
    startAnimation
  )

  const animatedSupplyAPY = useCountUp(
    vaultData.supplyAPY !== 'not coming' ? vaultData.supplyAPY : 0,
    1333,
    formatPercentage,
    startAnimation
  )

  const animatedUtilization = useCountUp(
    utilizationPct,
    1333,
    formatPercentage,
    startAnimation
  )

  // Animate circular indicator - calculate target dash offset
  const targetDashOffset = (1 - utilizationPct / 100) * circumference

  const handleSupply = async () => {
    const amount = parseFloat(supplyAmount)
    if (!amount || amount <= 0) return
    try {
      setIsSupplying(true)
      setTxStatus(null)
      const txId = await createLendingPosition(supplyAmount, asset.symbol)
      setTxStatus({ type: 'success', amount, symbol: asset.symbol, txId })
      setSupplyAmount('')
      
      if (onSupplySuccess) {
        console.log('🔄 Refreshing vault data after successful supply...')
        await onSupplySuccess()
      }
    } catch (error) {
      setTxStatus({
        type: 'error',
        message: error?.message ? `Supply failed: ${error.message}` : 'Supply failed. Please try again.'
      })
    } finally {
      setIsSupplying(false)
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
          Back to Lend
        </motion.button>

        <motion.div
          className="mb-6 md:mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-neutral-800 border-2 border-neutral-950 flex items-center justify-center text-white font-bold text-lg md:text-xl flex-shrink-0">
              {asset.symbol?.substring(0, 1) || '?'}
            </div>
            <div>
              <div className="text-xs text-gray-500">{vaultData.market}</div>
              <h1 className="text-2xl md:text-4xl font-bold text-white">{asset.symbol}</h1>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 md:gap-8">
            <div>
              <div className="text-gray-500 text-xs md:text-sm mb-1">Total supply</div>
              <div className="text-lg md:text-3xl font-bold text-white">
                {vaultData.totalSupply !== 'not coming' ? animatedTotalSupply : vaultData.totalSupply}
              </div>
              <div className="text-xs text-gray-500 hidden md:block">{vaultData.totalSupplyTokens}</div>
            </div>
            <div>
              <div className="text-gray-500 text-xs md:text-sm mb-1">Supply APY</div>
              <div className="text-lg md:text-3xl font-bold text-white">
                {vaultData.supplyAPY !== 'not coming' ? animatedSupplyAPY : vaultData.supplyAPY}
              </div>
            </div>
            <div>
              <div className="text-gray-500 text-xs md:text-sm mb-1">Utilization</div>
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-8 h-8 md:w-12 md:h-12">
                  <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                    <circle
                      cx="18"
                      cy="18"
                      r={radius}
                      fill="none"
                      className="stroke-neutral-800"
                      strokeWidth="4"
                    />
                    <motion.circle
                      cx="18"
                      cy="18"
                      r={radius}
                      fill="none"
                      className="stroke-[#c5ff4a]"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      initial={{ strokeDashoffset: circumference }}
                      animate={{ strokeDashoffset: targetDashOffset }}
                      transition={{ duration: 1.333, ease: "easeOut" }}
                    />
                  </svg>
                </div>
                <div className="text-lg md:text-3xl font-bold text-white">
                  {utilizationPct > 0 ? animatedUtilization : vaultData.utilization}
                </div>
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
                  <div className="text-xs text-gray-500 mb-2">Oracle price</div>
                  <div className="text-lg font-semibold text-white">{vaultData.oraclePrice}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-2">Market</div>
                  <div className="text-lg font-semibold text-white">{vaultData.market}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-2">Vault type</div>
                  <span className="text-sm font-medium text-white">{vaultData.vaultType}</span>
                </div>
              </div>
            </motion.div>

            <motion.div
              className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 md:p-6"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.3 }}
            >
              <h3 className="text-lg md:text-xl font-bold text-white mb-4 md:mb-6">Statistics</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
                <div>
                  <div className="text-xs text-gray-500 mb-2">Total borrowed</div>
                  <div className="text-xl font-bold text-white">{vaultData.totalBorrowed}</div>
                  <div className="text-sm text-gray-400 mt-1">{vaultData.totalBorrowedToken}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-2">Available liquidity</div>
                  <div className="text-xl font-bold text-white">{vaultData.availableLiquidity}</div>
                  <div className="text-sm text-gray-400 mt-1">{vaultData.availableLiquidityToken}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-2">Borrow APY</div>
                  <div className="text-xl font-bold text-white">{vaultData.borrowAPY}</div>
                </div>
              </div>
            </motion.div>

            <motion.div
              className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 md:p-6"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.4 }}
            >
              <div className="flex items-center gap-2 mb-4">
                <h3 className="text-lg md:text-xl font-bold text-white">Interest rate model</h3>
                <span className="px-2 py-0.5 bg-[#c5ff4a] text-neutral-900 text-xs font-semibold rounded">Kink</span>
              </div>
              <IRMGraph currentUtilization={parseFloat(vaultData.utilization) || 0} />
            </motion.div>
          </div>

          <div className="lg:sticky lg:top-8 h-fit">
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 md:p-6">
              <h3 className="text-base md:text-lg font-semibold text-white mb-4 md:mb-6">
                Supply {asset.symbol}
              </h3>

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
                      <div className="font-medium">Successfully supplied {txStatus.amount} {txStatus.symbol}</div>
                      {txStatus.txId && (
                        <div className="mt-1 text-xs text-inherit font-mono break-all">
                          tx: {txStatus.txId}
                        </div>
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
                  value={supplyAmount}
                  onChange={(e) => setSupplyAmount(e.target.value)}
                  placeholder="0"
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-4 text-white text-2xl font-bold focus:outline-none focus:border-neutral-600"
                  disabled={!isWalletConnected}
                />
              </div>

              <div className="space-y-3 mb-6 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Supply APY</span>
                  <span className="text-white font-medium">{vaultData.supplyAPY}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Estimated gas fee</span>
                  <span className="text-white font-medium">0 ETH <span className="text-gray-500">$0</span></span>
                </div>
              </div>

              {isWalletConnected ? (
                <button
                  onClick={handleSupply}
                  disabled={isSupplying || !supplyAmount || parseFloat(supplyAmount) <= 0}
                  aria-busy={isSupplying ? 'true' : 'false'}
                  aria-live="polite"
                  className={`w-full font-semibold py-3 rounded-lg transition-colors ${
                    isSupplying || !supplyAmount || parseFloat(supplyAmount) <= 0
                      ? 'bg-neutral-700 text-gray-500 cursor-not-allowed'
                      : 'bg-[#c5ff4a] hover:bg-[#b0e641] text-neutral-900'
                  }`}
                >
                  {isSupplying ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <span className="inline-block w-4 h-4 rounded-full border-2 border-[#c5ff4a] border-t-transparent animate-spin"></span>
                      Supplying…
                    </span>
                  ) : (
                    'Supply'
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
