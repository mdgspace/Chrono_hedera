import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'// eslint-disable-line no-unused-vars
import {
  SearchIcon,
  GridIcon,
  ListIcon
} from './Icons'
import { fetchPoolData } from '../utils/poolData'
import PoolDetailView from './PoolDetailView'

export default function PoolsView({ isWalletConnected, onConnect, userAddress }) {
  const [activeTab, setActiveTab] = useState('pools')
  const [viewMode, setViewMode] = useState('grid')
  const [isLoading, setIsLoading] = useState(true)
  const [poolData, setPoolData] = useState(null)
  const [showDetail, setShowDetail] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        setIsLoading(true)
        setError(null)
        const data = await fetchPoolData()
        if (mounted) {
          setPoolData(data?.data || data)
        }
      } catch (e) {
        console.error('Failed to load pool data', e)
        if (mounted) {
          setError(e.message || 'Failed to load pool data')
        }
      } finally {
        if (mounted) setIsLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  const formatNumber = (value) => {
    if (!value && value !== 0) return '—'
    const num = typeof value === 'string' ? parseFloat(value) : value
    if (isNaN(num)) return '—'
    if (num >= 1000000) return `$${(num / 1000000).toFixed(2)}M`
    if (num >= 1000) return `$${(num / 1000).toFixed(2)}K`
    return num.toFixed(2)
  }

  const totalLiquidity = poolData ? 
    (parseFloat(poolData.totalUSDCLiquidity || 0) + 
     parseFloat(poolData.totalETHLiquidity || 0) + 
     parseFloat(poolData.totalFlowLiquidity || 0)) : 0

  const pools = poolData ? [
    {
      ...poolData
    }
  ] : []

  if (showDetail && poolData) {
    return (
      <PoolDetailView
        pool={poolData}
        onBack={() => setShowDetail(false)}
        isWalletConnected={isWalletConnected}
        onConnect={onConnect}
        userAddress={userAddress}
      />
    )
  }

  const SkeletonPool = () => (
    <div className="bg-neutral-800/30 border border-neutral-700 rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex items-center">
            <div className="w-10 h-10 rounded-full bg-neutral-700 animate-shimmer"></div>
            <div className="w-10 h-10 rounded-full bg-neutral-700 animate-shimmer -ml-3"></div>
          </div>
          <div className="space-y-2">
            <div className="h-3 w-24 bg-neutral-700 rounded animate-shimmer"></div>
            <div className="h-5 w-32 bg-neutral-700 rounded animate-shimmer"></div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-5 gap-6">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-3 w-20 bg-neutral-700 rounded animate-shimmer"></div>
            <div className="h-5 w-24 bg-neutral-700 rounded animate-shimmer"></div>
          </div>
        ))}
      </div>
    </div>
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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white mb-1 md:mb-2">Pools</h1>
            <p className="text-gray-400 text-xs md:text-sm max-w-2xl">
              Browse pools or add liquidity on EulerSwap. Smarter yield, deeper liquidity, and LPs as collateral.
            </p>
          </div>
        </div>

        <div className="flex gap-6 md:gap-12 md:mt-2">
          <motion.div
            className="text-left md:text-right"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            <p className="text-gray-500 text-xs mb-1">Total Shares</p>
            {isLoading ? (
              <div className="h-6 md:h-8 w-24 md:w-32 bg-neutral-700 rounded animate-shimmer"></div>
            ) : (
              <p className="text-xl md:text-2xl font-semibold text-gray-300">{poolData?.totalShares || '—'}</p>
            )}
          </motion.div>
          <motion.div
            className="text-left md:text-right"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
          >
            <p className="text-gray-500 text-xs mb-1">Total Contributors</p>
            {isLoading ? (
              <div className="h-6 md:h-8 w-24 md:w-32 bg-neutral-700 rounded animate-shimmer"></div>
            ) : (
              <p className="text-xl md:text-2xl font-semibold text-gray-300">{poolData?.totalContributors || '—'}</p>
            )}
          </motion.div>
        </div>
      </motion.div>

      <div className="border-b border-neutral-700">
        <div className="flex gap-8">
          <button
            onClick={() => setActiveTab('pools')}
            className={`pb-3 px-1 text-sm font-medium transition-colors relative ${activeTab === 'pools'
              ? 'text-white'
              : 'text-gray-500 hover:text-gray-300'
              }`}
          >
            Pools
            {activeTab === 'pools' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#c5ff4a]"></div>
            )}
          </button>
          <button
            onClick={() => setActiveTab('incentivised')}
            className={`pb-3 px-1 text-sm font-medium transition-colors relative ${activeTab === 'incentivised'
              ? 'text-white'
              : 'text-gray-500 hover:text-gray-300'
              }`}
          >
            Incentivised pairs
            {activeTab === 'incentivised' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#c5ff4a]"></div>
            )}
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <div className="hidden md:flex items-center gap-2 px-3 py-2 bg-neutral-800/50 border border-neutral-700 rounded-lg text-sm">
            <span className="text-gray-400">Base asset is</span>
            <button className="px-2 py-0.5 bg-neutral-700 hover:bg-neutral-600 rounded text-white font-medium">
              any asset
            </button>
          </div>

          <div className="hidden md:flex items-center gap-2 px-3 py-2 bg-neutral-800/50 border border-neutral-700 rounded-lg text-sm">
            <span className="text-gray-400">Quote asset is</span>
            <button className="px-2 py-0.5 bg-neutral-700 hover:bg-neutral-600 rounded text-white font-medium">
              any asset
            </button>
          </div>

          <div className="hidden md:flex items-center gap-2 px-3 py-2 bg-neutral-800/50 border border-neutral-700 rounded-lg text-sm">
            <span className="text-gray-400">Available liquidity is</span>
            <button className="px-2 py-0.5 bg-neutral-700 hover:bg-neutral-600 rounded text-white font-medium">
              &gt;$1,000
            </button>
            <button className="text-gray-400 hover:text-white">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </div>

          <div className="hidden md:flex items-center gap-2 px-3 py-2 bg-neutral-800/50 border border-neutral-700 rounded-lg text-sm">
            <span className="text-gray-400">LP NAV is</span>
            <button className="px-2 py-0.5 bg-neutral-700 hover:bg-neutral-600 rounded text-white font-medium">
              anything
            </button>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 bg-neutral-800/50 border border-neutral-700 rounded-lg text-sm">
            <span className="text-gray-400 text-xs md:text-sm">Known assets only</span>
            <button className="w-10 h-5 bg-[#c5ff4a] rounded-full relative">
              <div className="absolute right-0.5 top-0.5 w-4 h-4 bg-white rounded-full"></div>
            </button>
          </div>
        </div>

        <button className="w-full md:w-auto px-6 py-2 bg-[#c5ff4a] hover:bg-[#b0e641] text-neutral-900 font-semibold rounded-lg transition-colors">
          Create Pool
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setViewMode('grid')}
          className={`p-2 rounded ${viewMode === 'grid'
            ? 'bg-[#c5ff4a]/10 text-[#c5ff4a]'
            : 'bg-neutral-800/50 text-gray-400 hover:text-gray-300'
            }`}
        >
          <GridIcon />
        </button>
        <button
          onClick={() => setViewMode('list')}
          className={`p-2 rounded ${viewMode === 'list'
            ? 'bg-[#c5ff4a]/10 text-[#c5ff4a]'
            : 'bg-neutral-800/50 text-gray-400 hover:text-gray-300'
            }`}
        >
          <ListIcon />
        </button>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-700 rounded-xl p-4 text-red-400">
          <p className="font-semibold">Failed to load pool data</p>
          <p className="text-sm mt-1">{error}</p>
          <p className="text-xs mt-2">Make sure the backend server is running on port 3001</p>
        </div>
      )}

      <div className="space-y-4">
        {isLoading ? (
          <>
            <SkeletonPool />
          </>
        ) : pools.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-gray-500">No pool data available</div>
          </div>
        ) : (
          pools.map((pool, index) => (
            <motion.div
              key={index}
              className="bg-neutral-800/30 border border-neutral-700 rounded-xl p-2 md:p-3 hover:border-neutral-600 transition-colors"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.4,
                delay: index * 0.1,
                ease: [0.4, 0, 0.2, 1]
              }}
              onClick={() => setShowDetail(true)}
            >
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <div className="flex items-center">
                    <div className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-neutral-700 border border-neutral-800 flex items-center justify-center text-sm md:text-base">
                      P
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500 mb-0.5">Liquidation Pool</div>
                    <div className="text-base md:text-lg font-bold text-white">USDC Pool</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-6 gap-2 md:gap-3 items-center">
                <div>
                  <div className="text-[10px] text-gray-500 mb-0.5">Total Shares</div>
                  <div className="text-sm font-semibold text-white">{pool.totalShares || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 mb-0.5">USDC Liquidity</div>
                  <div className="text-sm font-semibold text-white">{pool.totalUSDCLiquidity || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 mb-0.5">ETH Liquidity</div>
                  <div className="text-sm font-semibold text-white">{pool.totalETHLiquidity || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 mb-0.5">FLOW Liquidity</div>
                  <div className="text-sm font-semibold text-white">{pool.totalFlowLiquidity || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 mb-0.5">Contributors</div>
                  <div className="text-sm font-semibold text-white">{pool.totalContributors || '—'}</div>
                </div>
                {isWalletConnected ? (
                  <button className="w-full font-semibold py-3 rounded-lg bg-[#c5ff4a] hover:bg-[#b0e641] text-neutral-900">
                    Add Liquidity
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
            </motion.div>

          )))}
      </div>

      {activeTab === 'incentivised' && (
        <div className="text-center py-16">
          <div className="text-gray-500">No incentivised pairs available</div>
        </div>
      )}
    </div>
  )
}

