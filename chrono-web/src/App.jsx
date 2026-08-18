import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion' // eslint-disable-line no-unused-vars
import Navbar from './components/Navbar'
import LendView from './components/LendView'
import BorrowView from './components/BorrowView'
import PoolsView from './components/PoolsView'
import FaucetView from './components/FaucetView'
import PortfolioView from './components/PortfolioView'
import WalletModal from './components/WalletModal'
import { connectWallet, disconnectWallet, subscribeToAccountChanges } from './utils/hederaWallet'
import { fetchVaultDataFromBackend } from './utils/vaultData'

function App() {
  const [activeView, setActiveView] = useState('lend')
  const [isWalletConnected, setIsWalletConnected] = useState(false)
  const [walletAddress, setWalletAddress] = useState('')
  const [fullWalletAddress, setFullWalletAddress] = useState('')
  const [signer, setSigner] = useState(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  useEffect(() => {
    fetchVaultDataFromBackend().catch(err => {
      console.warn('Could not update vault data on page load:', err)
    })

    const unsubscribe = subscribeToAccountChanges((address) => {
      if (address) {
        setIsWalletConnected(true)
        setFullWalletAddress(address)
        setWalletAddress(formatAddress(address))
        // Re-fetch signer when account changes
        connectWallet().then(res => setSigner(res.signer)).catch(console.error)
      } else {
        setIsWalletConnected(false)
        setWalletAddress('')
        setFullWalletAddress('')
        setSigner(null)
      }
    })

    // Check initial connection silently
    if (window.ethereum) {
      window.ethereum.request({ method: 'eth_accounts' })
        .then(accounts => {
          if (accounts.length > 0) {
            setIsWalletConnected(true)
            setFullWalletAddress(accounts[0])
            setWalletAddress(formatAddress(accounts[0]))
            connectWallet().then(res => setSigner(res.signer)).catch(console.error)
          }
        }).catch(console.error)
    }

    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [])

  const formatAddress = (address) => {
    if (!address) return ''
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  const handleConnect = async () => {
    try {
      const { signer, address } = await connectWallet()
      setSigner(signer)
      setIsWalletConnected(true)
      setFullWalletAddress(address)
      setWalletAddress(formatAddress(address))
    } catch (error) {
      console.error('Failed to connect:', error)
      alert('Failed to connect wallet. Please try again.')
    }
  }

  const handleConnectModal = () => {
    setIsModalOpen(true)
  }

  const handleDisconnect = async () => {
    try {
      await disconnectWallet()
      setIsWalletConnected(false)
      setWalletAddress('')
      setFullWalletAddress('')
      setSigner(null)
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
        onConnect={handleConnectModal}
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
                onConnect={handleConnectModal} 
                userAddress={walletAddress} 
                signer={signer}
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
                onConnect={handleConnectModal} 
                userAddress={fullWalletAddress} 
                signer={signer}
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
                onConnect={handleConnectModal}
                userAddress={walletAddress}
                signer={signer}
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
                onConnect={handleConnectModal}
                userAddress={walletAddress}
                signer={signer}
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
                onConnect={handleConnectModal}
                userAddress={fullWalletAddress}
                signer={signer}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <WalletModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConnect={handleConnect}
      />
    </div>
  )
}

export default App