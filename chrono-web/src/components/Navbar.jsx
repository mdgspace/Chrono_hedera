import { motion } from 'framer-motion'// eslint-disable-line no-unused-vars
import { useState, useEffect, useRef } from 'react'

export default function Navbar({ 
  activeView, 
  setActiveView, 
  isWalletConnected, 
  walletAddress,
  onConnect,
  onDisconnect 
}) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isWalletDropdownOpen, setIsWalletDropdownOpen] = useState(false)
  const walletDropdownRef = useRef(null)
  
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (walletDropdownRef.current && !walletDropdownRef.current.contains(event.target)) {
        setIsWalletDropdownOpen(false)
      }
    }
    
    if (isWalletDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isWalletDropdownOpen])
  
  const navItems = [
    { id: 'lend', label: 'Lend' },
    { id: 'borrow', label: 'Borrow' },
    { id: 'pools', label: 'Pools' },
    { id: 'faucet', label: 'Faucet' }
  ]

  const handleNavClick = (id) => {
    setActiveView(id)
    setIsMobileMenuOpen(false)
  }

  return (
    <nav className="border-b border-neutral-800 bg-neutral-900 sticky top-0 z-50 backdrop-blur-sm bg-neutral-900/95">
      <div className="container mx-auto px-4">
        <div className="flex items-center h-16 gap-3 md:gap-6">
          <span className="text-lg md:text-xl font-bold text-white">
            Chrono
          </span>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-1 relative">
            {navItems.map((item) => (
              <motion.button
                key={item.id}
                onClick={() => setActiveView(item.id)}
                className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 relative ${
                  activeView === item.id
                    ? 'text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {activeView === item.id && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute inset-0 bg-neutral-800 rounded-lg"
                    style={{ zIndex: -1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
                {item.label}
              </motion.button>
            ))}
          </div>

          <div className="flex-1"></div>

          {/* Desktop Wallet Actions */}
          {isWalletConnected ? (
            <motion.div 
              className="hidden md:flex items-center gap-3 relative"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <div className="relative" ref={walletDropdownRef}>
                <button
                  onClick={() => setIsWalletDropdownOpen(!isWalletDropdownOpen)}
                  className="px-4 py-2 bg-neutral-800 border border-neutral-800 rounded-lg text-gray-300 text-sm font-medium hover:bg-neutral-700 transition-all duration-200 flex items-center gap-2"
                >
                  {walletAddress}
                  <svg 
                    className={`w-4 h-4 transition-transform ${isWalletDropdownOpen ? 'rotate-180' : ''}`} 
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {isWalletDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute right-0 mt-2 w-56 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl z-50"
                  >
                    <div className="py-2">
                      <div className="px-4 py-2 text-gray-300 text-sm border-b border-neutral-700">
                        {walletAddress}
                      </div>
                      <button
                        onClick={() => {
                          setActiveView('portfolio')
                          setIsWalletDropdownOpen(false)
                        }}
                        className="w-full text-left px-4 py-2 text-gray-300 hover:bg-neutral-700 transition-colors text-sm"
                      >
                        Portfolio
                      </button>
                      <button
                        onClick={() => {
                          onDisconnect()
                          setIsWalletDropdownOpen(false)
                        }}
                        className="w-full text-left px-4 py-2 text-gray-400 hover:bg-neutral-700 hover:text-white transition-colors text-sm"
                      >
                        Disconnect
                      </button>
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.button
              onClick={onConnect}
              className="hidden md:block px-6 py-2 bg-[#c5ff4a] hover:bg-[#b0e641] text-neutral-900 font-semibold rounded-lg transition-all duration-200"
              whileHover={{ scale: 1.05, boxShadow: "0 0 20px rgba(197, 255, 74, 0.3)" }}
              whileTap={{ scale: 0.95 }}
            >
              Connect
            </motion.button>
          )}

          {/* Mobile Connect Button */}
          {!isWalletConnected && (
            <button
              onClick={onConnect}
              className="md:hidden px-3 py-1.5 bg-[#c5ff4a] hover:bg-[#b0e641] text-neutral-900 font-semibold rounded-lg text-sm transition-all duration-200"
            >
              Connect
            </button>
          )}

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden p-2 text-gray-400 hover:text-white"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {isMobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <motion.div 
            className="md:hidden py-4 border-t border-neutral-800"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <div className="flex flex-col gap-2">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item.id)}
                  className={`px-4 py-3 rounded-lg font-medium text-left transition-colors ${
                    activeView === item.id
                      ? 'bg-neutral-800 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-neutral-800/50'
                  }`}
                >
                  {item.label}
                </button>
              ))}
              {isWalletConnected && (
                <>
                  <div className="px-4 py-3 bg-neutral-800 rounded-lg text-gray-300 text-sm font-medium mt-2">
                    {walletAddress}
                  </div>
                  <button
                    onClick={() => {
                      setActiveView('portfolio')
                      setIsMobileMenuOpen(false)
                    }}
                    className="px-4 py-3 bg-neutral-800 rounded-lg text-gray-300 hover:text-white text-sm font-medium text-left"
                  >
                    Portfolio
                  </button>
                  <button
                    onClick={() => {
                      onDisconnect()
                      setIsMobileMenuOpen(false)
                    }}
                    className="px-4 py-3 bg-neutral-800 rounded-lg text-gray-400 hover:text-white text-sm font-medium"
                  >
                    Disconnect
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </nav>
  )
}

