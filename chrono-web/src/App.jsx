import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion' // eslint-disable-line no-unused-vars
import Navbar from './components/Navbar'
import LendView from './components/LendView'
import BorrowView from './components/BorrowView'
import PoolsView from './components/PoolsView'
import FaucetView from './components/FaucetView'
import PortfolioView from './components/PortfolioView'
import WalletModal from './components/WalletModal'
import { connectWallet, disconnectWallet, configureFCL, subscribeToUser } from './utils/flowWallet'
import { updateVaultDataFromBackend } from './utils/vaultData'

function App() {
  const [activeView, setActiveView] = useState('lend')
  const [isWalletConnected, setIsWalletConnected] = useState(false)
  const [walletAddress, setWalletAddress] = useState('')
  const [fullWalletAddress, setFullWalletAddress] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)

  useEffect(() => {
    configureFCL()

    updateVaultDataFromBackend().catch(err => {
      console.warn('Could not update vault data on page load:', err)
    })

    const unsubscribe = subscribeToUser((user) => {
      if (user && user.loggedIn && user.addr) {
        setIsWalletConnected(true)
        setFullWalletAddress(user.addr)
        setWalletAddress(formatAddress(user.addr))
      } else {
        setIsWalletConnected(false)
        setWalletAddress('')
        setFullWalletAddress('')
      }
    })

    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [])

  const formatAddress = (address) => {
    if (!address) return ''
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  const handleConnect = () => {
    setIsModalOpen(true)
  }

  const handleConnectFlow = async () => {
    try {
      await connectWallet()
    } catch (error) {
      console.error('Failed to connect:', error)
      alert('Failed to connect wallet. Please try again.')
    }
  }

  const handleDisconnect = async () => {
    try {
      await disconnectWallet()
    } catch (error) {
      console.error('Failed to disconnect:', error)
    }
  }


  const pageVariants = {
    initial: { 
      opacity: 0, 
      y: 8,      
      scale: 0.99  
    },
    animate: { 
      opacity: 1, 
      y: 0,
      scale: 1,
      transition: {
        duration: 0.25, 
        ease: [0.4, 0, 0.2, 1]
      }
    },
    exit: { 
      opacity: 0, 
      y: -8,    
      scale: 0.99,
      transition: {
        duration: 0.2, 
        ease: [0.4, 0, 1, 1]
      }
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950">
      <Navbar 
        activeView={activeView}
        setActiveView={setActiveView}
        isWalletConnected={isWalletConnected}
        walletAddress={walletAddress}
        onConnect={handleConnectFlow}
        onDisconnect={handleDisconnect}
      />
      
      <main className="container mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
          {activeView === 'lend' && (
            <motion.div
              key="lend"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <LendView 
                isWalletConnected={isWalletConnected} 
                onConnect={handleConnect} 
                userAddress={walletAddress} 
              />
            </motion.div>
          )}
          {activeView === 'borrow' && (
            <motion.div
              key="borrow"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <BorrowView 
                isWalletConnected={isWalletConnected} 
                onConnect={handleConnect} 
                userAddress={fullWalletAddress} 
              />
            </motion.div>
          )}
          {activeView === 'pools' && (
            <motion.div
              key="pools"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <PoolsView 
                isWalletConnected={isWalletConnected}
                onConnect={handleConnectFlow}
                userAddress={walletAddress}
              />
            </motion.div>
          )}
          {activeView === 'faucet' && (
            <motion.div
              key="faucet"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <FaucetView 
                isWalletConnected={isWalletConnected}
                onConnect={handleConnectFlow}
                userAddress={walletAddress}
              />
            </motion.div>
          )}
          {activeView === 'portfolio' && (
            <motion.div
              key="portfolio"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <PortfolioView 
                isWalletConnected={isWalletConnected}
                onConnect={handleConnect}
                userAddress={fullWalletAddress}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <WalletModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConnectFlow={handleConnectFlow}
      />
    </div>
  )
}

export default App