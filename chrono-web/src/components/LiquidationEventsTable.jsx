import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

export default function LiquidationEventsTable({ pool = 'wUSDC' }) {
  const [events, setEvents] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let mounted = true
    async function loadEvents() {
      try {
        setIsLoading(true)
        const resp = await fetch(`http://localhost:3001/api/v1/liquidations/history?pool=${pool}`)
        if (!resp.ok) throw new Error('Failed to fetch liquidations')
        const json = await resp.json()
        if (mounted) {
          setEvents(json.data || [])
        }
      } catch (err) {
        if (mounted) setError(err.message)
      } finally {
        if (mounted) setIsLoading(false)
      }
    }
    loadEvents()
    return () => { mounted = false }
  }, [pool])

  if (isLoading) {
    return (
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 md:p-6 mt-6">
        <h3 className="text-lg md:text-xl font-bold text-white mb-4">Liquidation Events</h3>
        <div className="h-24 flex items-center justify-center text-gray-500">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 md:p-6 mt-6">
        <h3 className="text-lg md:text-xl font-bold text-white mb-4">Liquidation Events</h3>
        <div className="text-red-400">Failed to load events: {error}</div>
      </div>
    )
  }

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 md:p-6 mt-6">
      <h3 className="text-lg md:text-xl font-bold text-white mb-4">Liquidation Events</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-neutral-800">
              <th className="py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
              <th className="py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Position ID</th>
              <th className="py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Debt Repaid</th>
              <th className="py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Collateral Seized</th>
              <th className="py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Time</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan="5" className="py-8 text-center text-gray-500 text-sm">
                  No liquidation events found.
                </td>
              </tr>
            ) : (
              events.map((evt, idx) => (
                <tr key={idx} className="border-b border-neutral-800/50 hover:bg-neutral-800/20 transition-colors">
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      evt.type === 'HardLiquidation' ? 'bg-red-900/30 text-red-400' : 'bg-orange-900/30 text-orange-400'
                    }`}>
                      {evt.type}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-300 font-mono">
                    {evt.position_id ? `${evt.position_id.substring(0, 8)}...${evt.position_id.substring(evt.position_id.length - 6)}` : '—'}
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-300">{evt.debt_repaid || '—'}</td>
                  <td className="py-3 px-4 text-sm text-gray-300">{evt.collateral_seized || '—'}</td>
                  <td className="py-3 px-4 text-sm text-gray-500">
                    {evt.timestamp ? new Date(evt.timestamp * 1000).toLocaleString() : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
