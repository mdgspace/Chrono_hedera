import { TrendUpIcon, InfoIcon } from './Icons'
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'// eslint-disable-line no-unused-vars
import BorrowPositionView from './BorrowPositionView'
import { fetchVaultData, transformForBorrowView } from '../utils/vaultData'
import { fetchUserBorrowingPositions, formatTokenAmount, formatTimestamp } from '../utils/portfolioData'
import { repayLoan } from '../utils/repay-loan'

export default function BorrowView({ 
  isWalletConnected, 
  onConnect, 
  userAddress 
}) {
  const [selectedAsset, setSelectedAsset] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [vaultData, setVaultData] = useState(null)
  const [error, setError] = useState(null)
  const [userPositions, setUserPositions] = useState([])
  const [isUserPosLoading, setIsUserPosLoading] = useState(true)
  const [repayingId, setRepayingId] = useState(null)
  
  useEffect(() => {
    async function loadVaultData() {
      try {
        setIsLoading(true)
        const data = await fetchVaultData()
        setVaultData(data)
        setError(null)
      } catch (err) {
        console.error('Failed to load vault data:', err)
        setError(err.message)
      } finally {
        setIsLoading(false)
      }
    }
    
    loadVaultData()
    
    // Refresh data every 5 minutes
    const interval = setInterval(loadVaultData, 20 * 1000)
    return () => clearInterval(interval)
  }, [])

  // Load user's active borrowing positions
  useEffect(() => {
    async function loadUserPositions() {
      try {
        if (!isWalletConnected || !userAddress) {
          setUserPositions([])
          setIsUserPosLoading(false)
          return
        }
        setIsUserPosLoading(true)
        const positions = await fetchUserBorrowingPositions(userAddress)
        setUserPositions(Array.isArray(positions) ? positions.filter(p => p.isActive) : [])
      } catch (e) {
        console.error('Failed to load user positions:', e)
        setUserPositions([])
      } finally {
        setIsUserPosLoading(false)
      }
    }

    loadUserPositions()
  }, [isWalletConnected, userAddress])

  const borrowAssets = vaultData ? transformForBorrowView(vaultData) : []

  if (selectedAsset) {
    return <BorrowPositionView 
      asset={selectedAsset} 
      onBack={() => setSelectedAsset(null)}
      isWalletConnected={isWalletConnected}
      onConnect={onConnect}
      userAddress={userAddress}
    />

  }

  const SkeletonRow = () => (
    <tr className="border-b border-neutral-700/50">
      <td className="p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-neutral-700 animate-shimmer"></div>
          <div className="space-y-2">
            <div className="h-4 w-24 bg-neutral-700 rounded animate-shimmer"></div>
            <div className="h-3 w-16 bg-neutral-700 rounded animate-shimmer"></div>
          </div>
        </div>
      </td>
      <td className="p-4">
        <div className="h-4 w-20 bg-neutral-700 rounded animate-shimmer"></div>
      </td>
      <td className="p-4">
        <div className="h-5 w-16 bg-neutral-700 rounded animate-shimmer"></div>
      </td>
      <td className="p-4">
        <div className="space-y-2">
          <div className="h-4 w-24 bg-neutral-700 rounded animate-shimmer"></div>
          <div className="h-3 w-32 bg-neutral-700 rounded animate-shimmer"></div>
        </div>
      </td>
      <td className="p-4">
        <div className="h-5 w-16 bg-neutral-700 rounded animate-shimmer"></div>
      </td>
      <td className="p-4">
        <div className="h-5 w-16 bg-neutral-700 rounded animate-shimmer"></div>
      </td>
    </tr>
  )

  return (
    <div className="space-y-6">
      <motion.div 
        className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 md:gap-6"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="flex items-start gap-3 md:gap-4">
          <div className="w-12 h-12 md:w-16 md:h-16 rounded-xl bg-neutral-800 border border-neutral-700 flex items-center justify-center mt-1 flex-shrink-0">
            <svg className="w-6 h-6 md:w-8 md:h-8 text-[#c5ff4a]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white mb-1 md:mb-2">Borrow</h1>
            <p className="text-gray-400 text-xs md:text-sm">Borrow assets using your collateral with dynamic LTV.</p>
          </div>
        </div>

        <motion.div 
          className="bg-neutral-800/50 border border-neutral-700 rounded-xl p-4 md:max-w-md"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <div className="flex items-start gap-2">
            <InfoIcon className="w-5 h-5 text-[#c5ff4a] mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-white font-semibold mb-1 text-sm md:text-base">Time-Based LTV</h3>
              <p className="text-gray-400 text-xs md:text-sm">
                Chrono uses dynamic LTV that adjusts based on your loan duration. 
                Shorter loans get higher LTV ratios.
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>

      <motion.div 
        className="bg-neutral-800/30 border border-neutral-700 rounded-xl p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.3 }}
      >
        <h2 className="text-xl font-bold text-white mb-4">Your Active Positions</h2>
        {isUserPosLoading ? (
          <div className="text-center py-8 text-gray-400">Loading positions...</div>
        ) : userPositions.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-neutral-800 flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-gray-400">No active borrowing positions</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-neutral-700">
                  <th className="text-left p-4 text-gray-400 font-medium text-sm">Collateral</th>
                  <th className="text-left p-4 text-gray-400 font-medium text-sm">Borrowed</th>
                  <th className="text-left p-4 text-gray-400 font-medium text-sm">Duration</th>
                  <th className="text-left p-4 text-gray-400 font-medium text-sm">Status</th>
                  <th className="text-left p-4 text-gray-400 font-medium text-sm">Opened</th>
                </tr>
              </thead>
              <tbody>
                {userPositions.map((p, idx) => (
                  <tr key={idx} className="border-b border-neutral-700/50">
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-neutral-700 flex items-center justify-center text-white font-semibold text-xs">
                          {p.collateralType?.substring(0, 2) || '—'}
                        </div>
                        <div>
                          <div className="text-white font-medium">{formatTokenAmount(p.collateralAmount)}</div>
                          <div className="text-gray-400 text-xs">{p.collateralType}</div>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="text-white font-medium">{formatTokenAmount(p.borrowAmount)}</div>
                      <div className="text-gray-400 text-xs">{p.borrowTokenType}</div>
                    </td>
                    <td className="p-4">
                      <div className="text-gray-300 font-medium">
                        {p.durationMinutes ? `${p.durationMinutes} min` : '—'}
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        p.isActive 
                          ? 'bg-green-900/30 text-green-400 border border-green-700/50'
                          : 'bg-gray-900/30 text-gray-400 border border-gray-700/50'
                      }`}>
                        {p.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="text-sm text-gray-400">{formatTimestamp(p.timestamp)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      {error && (
        <div className="bg-red-900/20 border border-red-700 rounded-xl p-4 text-red-400">
          <p className="font-semibold">Failed to load vault data</p>
          <p className="text-sm mt-1">{error}</p>
          <p className="text-xs mt-2">Make sure vault.json is up to date. Run: node update-vault-data.js</p>
        </div>
      )}

      <motion.div 
        className="bg-neutral-800/30 border border-neutral-700 rounded-xl overflow-hidden"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.4 }}
      >
        <div className="p-4 md:p-6 border-b border-neutral-700">
          <h2 className="text-lg md:text-xl font-bold text-white">Available to Borrow</h2>
        </div>
        
        <div className="overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr className="border-b border-neutral-700">
              <th className="text-left p-4 text-gray-400 font-medium text-sm">Asset</th>
              <th className="text-left p-4 text-gray-400 font-medium text-sm">Protocol</th>
              <th className="text-left p-4 text-gray-400 font-medium text-sm">Borrow APY</th>
              <th className="text-left p-4 text-gray-400 font-medium text-sm">Available Liquidity</th>
              <th className="text-left p-4 text-gray-400 font-medium text-sm">Max LTV</th>
              <th className="text-left p-4 text-gray-400 font-medium text-sm">Liquidation Threshold</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : (
              borrowAssets.map((asset, index) => (
              <motion.tr 
                key={index}
                onClick={() => setSelectedAsset(asset)}
                className="border-b border-neutral-700/50 hover:bg-neutral-800/50 transition-colors cursor-pointer"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ 
                  duration: 0.3, 
                  delay: index * 0.1,
                  ease: [0.4, 0, 0.2, 1]
                }}
              >
                <td className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-neutral-700 flex items-center justify-center text-white font-semibold">
                      {asset.symbol.substring(0, 2)}
                    </div>
                    <div>
                      <div className="text-white font-medium">{asset.name}</div>
                      <div className="text-gray-400 text-sm">{asset.symbol}</div>
                    </div>
                  </div>
                </td>
                <td className="p-4">
                  <span className="text-gray-300 text-sm">{asset.protocol}</span>
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-1">
                    <TrendUpIcon className="w-4 h-4 text-red-400" />
                    <span className="text-white font-medium">{asset.borrowAPY}</span>
                  </div>
                </td>
                <td className="p-4">
                  <div>
                    <div className="text-white font-medium">{asset.available}</div>
                    <div className="text-gray-400 text-sm">{asset.availableToken}</div>
                  </div>
                </td>
                <td className="p-4">
                  <span className="text-[#c5ff4a] font-medium">{asset.maxLTV}</span>
                </td>
                <td className="p-4">
                  <span className="text-orange-400 font-medium">{asset.liquidationThreshold}</span>
                </td>
              </motion.tr>
            )))}
          </tbody>
        </table>
        </div>
      </motion.div>
    </div>
  )
}
