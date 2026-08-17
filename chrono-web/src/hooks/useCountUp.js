import { useState, useEffect, useRef } from 'react'

/**
 * Custom hook for animating numbers counting up from 0 to a target value
 * @param {number|string} end - Target value (can be a number or formatted string)
 * @param {number} duration - Animation duration in milliseconds (default: 2000)
 * @param {Function} formatValue - Optional function to format the displayed value
 * @param {boolean} startAnimation - Whether to start the animation (default: true)
 * @returns {number|string} - The current animated value
 */
export function useCountUp(end, duration = 2000, formatValue = null, startAnimation = true) {
  const [value, setValue] = useState(0)
  const startTimeRef = useRef(null)
  const animationFrameRef = useRef(null)
  const isAnimatingRef = useRef(false)

  // Extract numeric value from formatted strings (e.g., "$1,234.56" -> 1234.56, "12.34%" -> 12.34)
  const extractNumericValue = (val) => {
    if (typeof val === 'number') return val
    if (typeof val === 'string') {
      // Remove currency symbols, commas, and percent signs, then parse
      const cleaned = val.replace(/[$,\s]/g, '').replace('%', '')
      const num = parseFloat(cleaned)
      return isNaN(num) ? 0 : num
    }
    return 0
  }

  const numericEnd = extractNumericValue(end)

  useEffect(() => {
    if (!startAnimation || numericEnd === 0) {
      setValue(numericEnd)
      return
    }

    // Reset when end value changes
    if (isAnimatingRef.current) {
      setValue(0)
      isAnimatingRef.current = false
    }

    const animate = (timestamp) => {
      if (!startTimeRef.current) {
        startTimeRef.current = timestamp
      }

      const elapsed = timestamp - startTimeRef.current
      const progress = Math.min(elapsed / duration, 1)

      // Easing function (ease-out)
      const easeOut = 1 - Math.pow(1 - progress, 3)
      const currentValue = numericEnd * easeOut

      setValue(currentValue)
      isAnimatingRef.current = progress < 1

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate)
      } else {
        setValue(numericEnd)
        isAnimatingRef.current = false
      }
    }

    startTimeRef.current = null
    animationFrameRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [numericEnd, duration, startAnimation])

  // Format the value if a formatter function is provided
  if (formatValue) {
    return formatValue(value)
  }

  // Try to preserve original format if it was a string
  if (typeof end === 'string') {
    // If original had %, add it back
    if (end.includes('%')) {
      return `${value.toFixed(2)}%`
    }
    // If original had $, add it back
    if (end.includes('$')) {
      // Try to detect if original had decimals
      const decimals = (end.match(/\.(\d+)/)?.[1] || '').length || 2
      return `$${value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
    }
    // Default: return with 2 decimals
    return value.toFixed(2)
  }

  return value
}

