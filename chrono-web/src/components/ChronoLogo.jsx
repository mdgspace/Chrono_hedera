export default function ChronoLogo() {
  return (
    <div className="relative w-10 h-10">
      <svg viewBox="0 0 100 100" className="w-full h-full">
        <defs>
          <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#60A5FA" />
            <stop offset="100%" stopColor="#A78BFA" />
          </linearGradient>
        </defs>
        
        <circle 
          cx="50" 
          cy="50" 
          r="45" 
          fill="none" 
          stroke="url(#logoGradient)" 
          strokeWidth="4"
        />
        
        <path
          d="M 50 15 L 50 50 L 75 70"
          stroke="url(#logoGradient)"
          strokeWidth="5"
          strokeLinecap="round"
          fill="none"
        />
        
        <circle cx="50" cy="50" r="4" fill="url(#logoGradient)" />
        
        <circle cx="50" cy="10" r="2" fill="#60A5FA" />
        <circle cx="90" cy="50" r="2" fill="#60A5FA" />
        <circle cx="50" cy="90" r="2" fill="#A78BFA" />
        <circle cx="10" cy="50" r="2" fill="#A78BFA" />
      </svg>
    </div>
  )
}









