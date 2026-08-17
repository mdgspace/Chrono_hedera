import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'// eslint-disable-line no-unused-vars

export default function IRMGraph({ currentUtilization }) {
  const svgRef = useRef()
  const [hoverPoint, setHoverPoint] = useState(null)

  // IRM Parameters (Kink model)
  const kinkUtilization = 80; // %
  const baseRate = 0.02;      // 2%
  const slope1 = 0.08;        // 8%
  const slope2 = 1.0;         // 100%
  const reserveFactor = 0.1;  // 10%

  useEffect(() => {
    const calculateBorrowAPY = (utilization) => {
      const u = utilization / 100;
      let rate;
      if (u <= kinkUtilization / 100)
        rate = baseRate + slope1 * u;
      else
        rate = baseRate + slope1 * (kinkUtilization / 100) + slope2 * (u - kinkUtilization / 100);
      return rate * 100; // %
    };

    const calculateSupplyAPY = (utilization) => {
      const borrowRate = calculateBorrowAPY(utilization) / 100;
      const u = utilization / 100;
      return borrowRate * u * (1 - reserveFactor) * 100; // %
    };
    const drawGraph = () => {
      const svg = svgRef.current
      if (!svg) return

      while (svg.firstChild) {
        svg.removeChild(svg.firstChild)
      }

      const width = svg.clientWidth || 600
      const height = svg.clientHeight || 320
      const padding = 60

      svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
      svg.setAttribute('class', 'w-full h-full')

      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      bg.setAttribute('width', width)
      bg.setAttribute('height', height)
      bg.setAttribute('fill', '#171717')
      svg.appendChild(bg)

      const maxAPY = calculateBorrowAPY(100)
      const minY = 0
      const maxY = maxAPY

      const ySteps = 6
      for (let i = 0; i <= ySteps; i++) {
        const yValue = minY + (maxY - minY) * i / ySteps
        const y = height - padding - ((yValue - minY) / (maxY - minY)) * (height - 2 * padding)

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
        line.setAttribute('x1', padding)
        line.setAttribute('y1', y)
        line.setAttribute('x2', width - padding)
        line.setAttribute('y2', y)
        line.setAttribute('stroke', '#262626')
        line.setAttribute('stroke-width', '1')
        svg.appendChild(line)

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        label.setAttribute('x', padding - 10)
        label.setAttribute('y', y + 4)
        label.setAttribute('fill', '#9ca3af')
        label.setAttribute('font-size', '10')
        label.setAttribute('text-anchor', 'end')
        label.textContent = yValue.toFixed(1) + '%'
        svg.appendChild(label)
      }
      const maxUtil = 100
      const xSteps = 5
      for (let i = 0; i <= xSteps; i++) {
        const xValue = (maxUtil / xSteps) * i
        const x = padding + (width - 2 * padding) * (xValue / maxUtil)

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        label.setAttribute('x', x)
        label.setAttribute('y', height - padding + 20)
        label.setAttribute('fill', '#9ca3af')
        label.setAttribute('font-size', '10')
        label.setAttribute('text-anchor', 'middle')
        label.textContent = xValue.toFixed(0) + '%'
        svg.appendChild(label)
      }

      const borrowDataPoints = []
      for (let util = 0; util <= maxUtil; util += 1) {
        const borrowAPY = calculateBorrowAPY(util)
        const x = padding + (width - 2 * padding) * (util / maxUtil)
        const y = height - padding - ((borrowAPY - minY) / (maxY - minY)) * (height - 2 * padding)
        borrowDataPoints.push({ x, y, util, borrowAPY })
      }

      const borrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      let borrowD = `M ${borrowDataPoints[0].x} ${borrowDataPoints[0].y}`
      for (let i = 1; i < borrowDataPoints.length; i++) {
        borrowD += ` L ${borrowDataPoints[i].x} ${borrowDataPoints[i].y}`
      }
      borrowPath.setAttribute('d', borrowD)
      borrowPath.setAttribute('stroke', '#fb923c')
      borrowPath.setAttribute('stroke-width', '2')
      borrowPath.setAttribute('fill', 'none')

      const borrowPathLength = borrowPath.getTotalLength()
      borrowPath.style.strokeDasharray = borrowPathLength
      borrowPath.style.strokeDashoffset = borrowPathLength
      borrowPath.style.animation = 'drawPath 1.5s ease-out forwards'

      svg.appendChild(borrowPath)

      const supplyDataPoints = []
      for (let util = 0; util <= maxUtil; util += 1) {
        const supplyAPY = calculateSupplyAPY(util)
        const x = padding + (width - 2 * padding) * (util / maxUtil)
        const y = height - padding - ((supplyAPY - minY) / (maxY - minY)) * (height - 2 * padding)
        supplyDataPoints.push({ x, y, util, supplyAPY })
      }

      const supplyPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      let supplyD = `M ${supplyDataPoints[0].x} ${supplyDataPoints[0].y}`
      for (let i = 1; i < supplyDataPoints.length; i++) {
        supplyD += ` L ${supplyDataPoints[i].x} ${supplyDataPoints[i].y}`
      }
      supplyPath.setAttribute('d', supplyD)
      supplyPath.setAttribute('stroke', '#c5ff4a')
      supplyPath.setAttribute('stroke-width', '2')
      supplyPath.setAttribute('fill', 'none')

      const supplyPathLength = supplyPath.getTotalLength()
      supplyPath.style.strokeDasharray = supplyPathLength
      supplyPath.style.strokeDashoffset = supplyPathLength
      supplyPath.style.animation = 'drawPath 1.5s ease-out 0.2s forwards'

      svg.appendChild(supplyPath)

      const kinkX = padding + (width - 2 * padding) * (kinkUtilization / maxUtil)
      const kinkLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      kinkLine.setAttribute('x1', kinkX)
      kinkLine.setAttribute('y1', padding)
      kinkLine.setAttribute('x2', kinkX)
      kinkLine.setAttribute('y2', height - padding)
      kinkLine.setAttribute('stroke', '#6366f1')
      kinkLine.setAttribute('stroke-width', '2')
      kinkLine.setAttribute('stroke-dasharray', '5,5')
      svg.appendChild(kinkLine)

      const kinkLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      kinkLabel.setAttribute('x', kinkX)
      kinkLabel.setAttribute('y', padding + 15)
      kinkLabel.setAttribute('fill', '#6366f1')
      kinkLabel.setAttribute('font-size', '10')
      kinkLabel.setAttribute('font-weight', 'bold')
      kinkLabel.setAttribute('text-anchor', 'middle')
      kinkLabel.textContent = `Kink (${kinkUtilization}%)`
      svg.appendChild(kinkLabel)

      if (currentUtilization > 0) {
        const currentBorrowAPY = calculateBorrowAPY(currentUtilization)
        const currentSupplyAPY = calculateSupplyAPY(currentUtilization)
        const markerX = padding + (width - 2 * padding) * (currentUtilization / maxUtil)
        const markerYBorrow = height - padding - ((currentBorrowAPY - minY) / (maxY - minY)) * (height - 2 * padding)
        const markerYSupply = height - padding - ((currentSupplyAPY - minY) / (maxY - minY)) * (height - 2 * padding)

        const currentLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
        currentLine.setAttribute('x1', markerX)
        currentLine.setAttribute('y1', padding)
        currentLine.setAttribute('x2', markerX)
        currentLine.setAttribute('y2', height - padding)
        currentLine.setAttribute('stroke', '#ef4444')
        currentLine.setAttribute('stroke-width', '2')
        currentLine.setAttribute('stroke-dasharray', '3,3')
        svg.appendChild(currentLine)

        const circleBorrow = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        circleBorrow.setAttribute('cx', markerX)
        circleBorrow.setAttribute('cy', markerYBorrow)
        circleBorrow.setAttribute('r', '4')
        circleBorrow.setAttribute('fill', '#fb923c')
        circleBorrow.setAttribute('stroke', '#fff')
        circleBorrow.setAttribute('stroke-width', '2')
        svg.appendChild(circleBorrow)

        const circleSupply = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        circleSupply.setAttribute('cx', markerX)
        circleSupply.setAttribute('cy', markerYSupply)
        circleSupply.setAttribute('r', '4')
        circleSupply.setAttribute('fill', '#c5ff4a')
        circleSupply.setAttribute('stroke', '#fff')
        circleSupply.setAttribute('stroke-width', '2')
        svg.appendChild(circleSupply)

        const currentLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        currentLabel.setAttribute('x', markerX)
        currentLabel.setAttribute('y', padding + 30)
        currentLabel.setAttribute('fill', '#ef4444')
        currentLabel.setAttribute('font-size', '11')
        currentLabel.setAttribute('font-weight', 'bold')
        currentLabel.setAttribute('text-anchor', 'middle')
        currentLabel.textContent = `Current: ${currentUtilization.toFixed(1)}%`
        svg.appendChild(currentLabel)

        const borrowLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        const borrowLabelX = Math.min(markerX + 12, width - padding - 40)
        borrowLabel.setAttribute('x', borrowLabelX)
        borrowLabel.setAttribute('y', markerYBorrow + 4)
        borrowLabel.setAttribute('fill', '#fb923c')
        borrowLabel.setAttribute('font-size', '10')
        borrowLabel.setAttribute('font-weight', 'bold')
        borrowLabel.setAttribute('text-anchor', 'start')
        borrowLabel.textContent = `${currentBorrowAPY.toFixed(2)}%`
        svg.appendChild(borrowLabel)

        const supplyLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        const supplyLabelX = Math.min(markerX + 12, width - padding - 40)
        supplyLabel.setAttribute('x', supplyLabelX)
        supplyLabel.setAttribute('y', markerYSupply + 4)
        supplyLabel.setAttribute('fill', '#c5ff4a')
        supplyLabel.setAttribute('font-size', '10')
        supplyLabel.setAttribute('font-weight', 'bold')
        supplyLabel.setAttribute('text-anchor', 'start')
        supplyLabel.textContent = `${currentSupplyAPY.toFixed(2)}%`
        svg.appendChild(supplyLabel)
      }

      const hoverRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      hoverRect.setAttribute('x', padding)
      hoverRect.setAttribute('y', padding)
      hoverRect.setAttribute('width', width - 2 * padding)
      hoverRect.setAttribute('height', height - 2 * padding)
      hoverRect.setAttribute('fill', 'transparent')
      hoverRect.style.cursor = 'crosshair'

      hoverRect.addEventListener('mousemove', (e) => {
        const rect = svg.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top

        const svgX = (mouseX / rect.width) * width
        const svgY = (mouseY / rect.height) * height

        if (svgX >= padding && svgX <= width - padding && svgY >= padding && svgY <= height - padding) {
          const util = ((svgX - padding) / (width - 2 * padding)) * maxUtil
          const borrowAPY = calculateBorrowAPY(util)
          const supplyAPY = calculateSupplyAPY(util)
          setHoverPoint({
            util: util.toFixed(1),
            borrowAPY: borrowAPY.toFixed(2),
            supplyAPY: supplyAPY.toFixed(2),
            x: svgX,
            y: svgY
          })
        }
      })

      hoverRect.addEventListener('mouseleave', () => {
        setHoverPoint(null)
      })

      svg.appendChild(hoverRect)

      const xLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      xLabel.setAttribute('x', width / 2)
      xLabel.setAttribute('y', height - 5)
      xLabel.setAttribute('fill', '#9ca3af')
      xLabel.setAttribute('font-size', '11')
      xLabel.setAttribute('text-anchor', 'middle')
      xLabel.textContent = 'Utilization Rate'
      svg.appendChild(xLabel)

      const yLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      yLabel.setAttribute('x', 12)
      yLabel.setAttribute('y', height / 2)
      yLabel.setAttribute('fill', '#9ca3af')
      yLabel.setAttribute('font-size', '11')
      yLabel.setAttribute('text-anchor', 'middle')
      yLabel.setAttribute('transform', `rotate(-90, 12, ${height / 2})`)
      yLabel.textContent = 'APY (%)'
      svg.appendChild(yLabel)
    }

    const timer = setTimeout(() => {
      drawGraph()
    }, 100)
    return () => clearTimeout(timer)
  }, [currentUtilization])

  return (
    <motion.div
      className="relative w-full h-80"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5 }}
    >
      <svg ref={svgRef} className="w-full h-full"></svg>
      {hoverPoint && (
        <motion.div
          className="absolute bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-xs text-white pointer-events-none z-10"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{
            left: `${hoverPoint.x}px`,
            top: `${hoverPoint.y - 10}px`,
            transform: 'translate(-50%, -100%)'
          }}
        >
          <div className="font-semibold mb-1">Utilization: {hoverPoint.util}%</div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#fb923c]"></div>
            <span className="text-[#fb923c]">Borrow APY: {hoverPoint.borrowAPY}%</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#c5ff4a]"></div>
            <span className="text-[#c5ff4a]">Supply APY: {hoverPoint.supplyAPY}%</span>
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}
