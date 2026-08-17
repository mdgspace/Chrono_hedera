import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { 
  fetchUserLendingPositions, 
  fetchUserBorrowingPositions,
  formatTokenAmount,
  formatTimestamp
} from '../utils/portfolioData'
import BorrowPositionDetailsView from './BorrowPositionDetailsView'
import LendingPositionDetailsView from './LendingPositionDetailsView'

export default function PortfolioView({ userAddress, isWalletConnected, onConnect }) {
  const [activeTab, setActiveTab] = useState('lending')
  const [lendingPositions, setLendingPositions] = useState([])
  const [borrowingPositions, setBorrowingPositions] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedLendingPosition, setSelectedLendingPosition] = useState(null)
  const [selectedBorrowPosition, setSelectedBorrowPosition] = useState(null)

  useEffect(() => {
    if (isWalletConnected && userAddress) {
      loadPositions()
    } else {
      setIsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userAddress, isWalletConnected])

  const loadPositions = async () => {
    setIsLoading(true)
    try {
      const [lending, borrowing] = await Promise.all([
        fetchUserLendingPositions(userAddress),
        fetchUserBorrowingPositions(userAddress)
      ])
      setLendingPositions(lending || [])
      setBorrowingPositions(borrowing || [])
      
      // Update selected positions if they're still in the list
      if (selectedLendingPosition) {
        const updatedPosition = lending?.find(p => p.id === selectedLendingPosition.id)
        if (updatedPosition) {
          setSelectedLendingPosition(updatedPosition)
        }
      }
      if (selectedBorrowPosition) {
        const updatedPosition = borrowing?.find(p => p.id === selectedBorrowPosition.id)
        if (updatedPosition) {
          setSelectedBorrowPosition(updatedPosition)
        }
      }
    } catch (error) {
      console.error('Failed to load positions:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Show detail view if position is selected
  if (selectedLendingPosition) {
    return (
      <LendingPositionDetailsView
        position={selectedLendingPosition}
        onBack={() => setSelectedLendingPosition(null)}
        isWalletConnected={isWalletConnected}
        onConnect={onConnect}
        userAddress={userAddress}
        onActionSuccess={loadPositions}
      />
    )
  }

  if (selectedBorrowPosition) {
    return (
      <BorrowPositionDetailsView
        position={selectedBorrowPosition}
        onBack={() => setSelectedBorrowPosition(null)}
        isWalletConnected={isWalletConnected}
        onConnect={onConnect}
        userAddress={userAddress}
        onActionSuccess={loadPositions}
      />
    )
  }

  if (!isWalletConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-bold text-white">Connect your wallet</h2>
          <p className="text-gray-400">Please connect your wallet to view your portfolio</p>
          <button
            onClick={onConnect}
            className="px-6 py-3 bg-[#c5ff4a] hover:bg-[#b0e641] text-neutral-900 font-semibold rounded-lg transition-all duration-200"
          >
            Connect Wallet
          </button>
        </div>
      </div>
    )
  }

  const SkeletonRow = ({ colSpan = 4 }) => (
    <tr className="border-b border-neutral-700/50">
      {Array.from({ length: colSpan }).map((_, i) => (
        <td key={i} className="p-4">
          <div className="h-4 w-24 bg-neutral-700 rounded animate-shimmer"></div>
        </td>
      ))}
    </tr>
  )

  return (
    <div className="space-y-6">
      <motion.div
        className="flex flex-col md:flex-row md:items-start md:justify-between gap-6"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="flex items-start gap-3 md:gap-4">
          <div className="w-12 h-12 md:w-16 md:h-16 rounded-xl bg-neutral-800 border border-neutral-700 flex items-center justify-center mt-1 flex-shrink-0">
            <svg className="w-6 h-6 md:w-8 md:h-8 text-[#c5ff4a]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white mb-1 md:mb-2">Portfolio</h1>
            <p className="text-gray-400 text-xs md:text-sm">View your lending and borrowing positions</p>
          </div>
        </div>
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-neutral-700">
        <button
          onClick={() => setActiveTab('lending')}
          className={`px-4 py-3 font-medium transition-colors relative ${
            activeTab === 'lending'
              ? 'text-white'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Lending Positions
          {activeTab === 'lending' && (
            <motion.div
              layoutId="activeTab"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#c5ff4a]"
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            />
          )}
        </button>
        <button
          onClick={() => setActiveTab('borrowing')}
          className={`px-4 py-3 font-medium transition-colors relative ${
            activeTab === 'borrowing'
              ? 'text-white'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Borrowed Positions
          {activeTab === 'borrowing' && (
            <motion.div
              layoutId="activeTab"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#c5ff4a]"
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            />
          )}
        </button>
      </div>

      {/* Lending Positions Tab */}
      {activeTab === 'lending' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="bg-neutral-800/30 border border-neutral-700 rounded-xl overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="border-b border-neutral-700">
                  <th className="text-left p-4 text-gray-400 font-medium text-sm">Token</th>
                  <th className="text-left p-4 text-gray-400 font-medium text-sm">Amount</th>
                  <th className="text-left p-4 text-gray-400 font-medium text-sm">Status</th>
                  <th className="text-left p-4 text-gray-400 font-medium text-sm">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <>
                    <SkeletonRow colSpan={4} />
                    <SkeletonRow colSpan={4} />
                    <SkeletonRow colSpan={4} />
                  </>
                ) : lendingPositions.length > 0 ? (
                  lendingPositions.map((position, index) => (
                    <motion.tr
                      key={index}
                      className="border-b border-neutral-700/50 hover:bg-neutral-800/50 transition-colors cursor-pointer"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{
                        duration: 0.3,
                        delay: index * 0.05,
                        ease: [0.4, 0, 0.2, 1]
                      }}
                      onClick={() => setSelectedLendingPosition(position)}
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-neutral-700 flex items-center justify-center text-white font-semibold text-xs">
                            {position.token?.substring(0, 2) || '—'}
                          </div>
                          <span className="text-gray-300 font-medium">{position.token || '—'}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="text-white font-medium">
                          {formatTokenAmount(position.amount)}
                        </div>
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          position.isActive 
                            ? 'bg-green-900/30 text-green-400 border border-green-700/50' 
                            : 'bg-gray-900/30 text-gray-400 border border-gray-700/50'
                        }`}>
                          {position.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="text-gray-400 text-sm">
                          {formatTimestamp(position.timestamp)}
                        </div>
                      </td>
                    </motion.tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" className="p-8 text-center text-gray-500">
                      No lending positions found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* Borrowing Positions Tab */}
      {activeTab === 'borrowing' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="bg-neutral-800/30 border border-neutral-700 rounded-xl overflow-x-auto">
            <table className="w-full min-w-[1120px]">
              <thead>
                <tr className="border-b border-neutral-700">
                  <th className="text-left p-4 text-gray-400 font-medium text-sm">Collateral</th>
                  <th className="text-left p-4 text-gray-400 font-medium text-sm">Borrowed</th>
                  <th className="text-left p-4 text-gray-400 font-medium text-sm">Duration</th>
                  <th className="text-left p-4 text-gray-400 font-medium text-sm">LTV</th>
                  <th className="text-left p-4 text-gray-400 font-medium text-sm">Health Factor</th>
                  <th className="text-left p-4 text-gray-400 font-medium text-sm">Status</th>
                  <th className="text-left p-4 text-gray-400 font-medium text-sm">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <>
                    <SkeletonRow colSpan={7} />
                    <SkeletonRow colSpan={7} />
                    <SkeletonRow colSpan={7} />
                  </>
                ) : borrowingPositions.length > 0 ? (
                  borrowingPositions.map((position, index) => (
                    <motion.tr
                      key={index}
                      className="border-b border-neutral-700/50 hover:bg-neutral-800/50 transition-colors cursor-pointer"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{
                        duration: 0.3,
                        delay: index * 0.05,
                        ease: [0.4, 0, 0.2, 1]
                      }}
                      onClick={() => setSelectedBorrowPosition(position)}
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-neutral-700 flex items-center justify-center text-white font-semibold text-xs">
                            {position.collateralType?.substring(0, 2) || '—'}
                          </div>
                          <div>
                            <div className="text-white font-medium">
                              {formatTokenAmount(position.collateralAmount)}
                            </div>
                            <div className="text-gray-400 text-xs">{position.collateralType || '—'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <div>
                          <div className="text-white font-medium">
                            {formatTokenAmount(position.borrowAmount)}
                          </div>
                          <div className="text-gray-400 text-xs">{position.borrowTokenType || '—'}</div>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="text-gray-300 font-medium">
                          {position.durationMinutes ? `${position.durationMinutes} min` : '—'}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="text-white font-medium">
                          {position.calculatedLTV ? `${(parseFloat(position.calculatedLTV) * 100).toFixed(2)}%` : '—'}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className={`font-medium ${
                          position.healthFactor 
                            ? parseFloat(position.healthFactor) > 1.5 
                              ? 'text-green-400' 
                              : parseFloat(position.healthFactor) > 1.0 
                                ? 'text-yellow-400' 
                                : 'text-red-400'
                            : 'text-gray-400'
                        }`}>
                          {position.healthFactor ? parseFloat(position.healthFactor).toFixed(2) : '—'}
                        </div>
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          position.isActive 
                            ? 'bg-green-900/30 text-green-400 border border-green-700/50'
                            : 'bg-gray-900/30 text-gray-400 border border-gray-700/50'
                        }`}>
                          {position.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="text-sm text-gray-400">{formatTimestamp(position.timestamp)}</div>
                      </td>
                    </motion.tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="7" className="p-8 text-center text-gray-500">
                      No borrowed positions found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </div>
  )
}
