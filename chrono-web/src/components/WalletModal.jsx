export default function WalletModal({ isOpen, onClose, onConnectFlow }) {
  if (!isOpen) return null

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-200"
        onClick={onClose}
      />
      
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl w-full max-w-md p-6 animate-fadeIn">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white">Connect Wallet</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors duration-200"
            >
              <svg 
                className="w-6 h-6" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M6 18L18 6M6 6l12 12" 
                />
              </svg>
            </button>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => {
                onConnectFlow()
                onClose()
              }}
              className="w-full flex items-center justify-between p-4 bg-neutral-800 hover:bg-neutral-750 border border-neutral-700 hover:border-[#c5ff4a] rounded-xl transition-all duration-200 group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-[#c5ff4a] rounded-xl flex items-center justify-center">
                  <svg 
                    className="w-7 h-7 text-neutral-900" 
                    viewBox="0 0 24 24" 
                    fill="currentColor"
                  >
                    <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5zm0 2.18l8 4V17c0 4.52-3.16 8.75-8 9.91-4.84-1.16-8-5.39-8-9.91V8.18l8-4z"/>
                  </svg>
                </div>
                <div className="text-left">
                  <div className="text-white font-semibold text-lg">Flow Wallet</div>
                  <div className="text-gray-400 text-sm">Connect with Flow blockchain</div>
                </div>
              </div>
              <svg 
                className="w-5 h-5 text-gray-400 group-hover:text-[#c5ff4a] transition-colors duration-200" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M9 5l7 7-7 7" 
                />
              </svg>
            </button>

            <button
              disabled
              className="w-full flex items-center justify-between p-4 bg-neutral-800/50 border border-neutral-700/50 rounded-xl cursor-not-allowed opacity-60"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-orange-400 to-orange-600 rounded-xl flex items-center justify-center">
                  <svg 
                    className="w-7 h-7 text-white" 
                    viewBox="0 0 24 24" 
                    fill="currentColor"
                  >
                    <path d="M22.05 11.86l-3.48-5.78-1.74 5.13 1.75 4.65h3.47zm-4.18-5.86l-1.77 5.28 1.77 4.72h2.83l-2.83-10zm-5.37 0l-1.25 3.66 1.25 6.34h2.5l1.25-6.34-1.25-3.66zm-3.5 0l-2.83 10h2.83l1.77-4.72-1.77-5.28zm-5.08 5.78l-1.74-5.13-3.48 5.78h3.47l1.75-4.65z"/>
                  </svg>
                </div>
                <div className="text-left">
                  <div className="text-white font-semibold text-lg">MetaMask</div>
                  <div className="text-gray-400 text-sm">Coming Soon</div>
                </div>
              </div>
              <div className="px-3 py-1 bg-neutral-700 rounded-lg">
                <span className="text-xs text-gray-400 font-medium">Soon</span>
              </div>
            </button>
          </div>

          <div className="mt-6 pt-4 border-t border-neutral-800">
            <p className="text-sm text-gray-500 text-center">
              By connecting, you agree to Chrono's Terms of Service
            </p>
          </div>
        </div>
      </div>
    </>
  )
}

