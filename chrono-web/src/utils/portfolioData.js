import { executeScript } from './flowWallet'
import * as fcl from '@onflow/fcl'

// Read Cadence scripts
const lendingPositionsScript = `
import TimeLendingProtocol2 from 0x904a8cd375b62ddc

access(all) fun main(user: Address): [{String: AnyStruct}] {
    let result: [{String: AnyStruct}] = []
    var id: UInt64 = 1
    while id < TimeLendingProtocol2.nextLendingPositionId {
        if let p = TimeLendingProtocol2.getLendingPosition(id: id) {
            if p.lender == user {
                result.append({
                    "id": p.id,
                    "token": TimeLendingProtocol2.getTokenSymbol(tokenType: p.tokenType),
                    "amount": p.amount,
                    "isActive": p.isActive,
                    "timestamp": p.timestamp
                })
            }
        }
        id = id + 1
    }
    return result
}
`

const borrowingPositionsScript = `
import TimeLendingProtocol2 from 0x904a8cd375b62ddc

access(all) fun main(user: Address): [{String: AnyStruct}] {
    let result: [{String: AnyStruct}] = []
    var id: UInt64 = 1
    while id < TimeLendingProtocol2.nextBorrowingPositionId {
        if let p = TimeLendingProtocol2.getBorrowingPosition(id: id) {
            if p.borrower == user {
                result.append({
                    "id": p.id,
                    "collateralType": TimeLendingProtocol2.getTokenSymbol(tokenType: p.collateralType),
                    "collateralAmount": p.collateralAmount,
                    "borrowTokenType": TimeLendingProtocol2.getTokenSymbol(tokenType: p.borrowTokenType),
                    "borrowAmount": p.borrowAmount,
                    "durationMinutes": p.durationMinutes,
                    "calculatedLTV": p.calculatedLTV,
                    "liquidationThreshold": p.liquidationThreshold,
                    "healthFactor": p.healthFactor,
                    "repaymentDeadline": p.repaymentDeadline,
                    "timestamp": p.timestamp,
                    "isActive": p.isActive
                })
            }
        }
        id = id + 1
    }
    return result
}
`

/**
 * Fetch user's lending positions
 * @param {string} userAddress - Flow address of the user
 * @returns {Promise<Array>} Array of lending positions
 */
export async function fetchUserLendingPositions(userAddress) {
  try {
    if (!userAddress) {
      return []
    }

    // Ensure Flow address has 0x prefix
    const flowAddress = userAddress.startsWith('0x') ? userAddress : `0x${userAddress}`
    
    const result = await executeScript(lendingPositionsScript, [
      fcl.arg(flowAddress, fcl.t.Address)
    ])
    
    // Filter only active positions if needed
    return result || []
  } catch (error) {
    console.error('Failed to fetch lending positions:', error)
    return []
  }
}

/**
 * Fetch user's borrowing positions
 * @param {string} userAddress - Flow address of the user
 * @returns {Promise<Array>} Array of borrowing positions
 */
export async function fetchUserBorrowingPositions(userAddress) {
  try {
    if (!userAddress) {
      return []
    }

    // Ensure Flow address has 0x prefix
    const flowAddress = userAddress.startsWith('0x') ? userAddress : `0x${userAddress}`
    
    const result = await executeScript(borrowingPositionsScript, [
      fcl.arg(flowAddress, fcl.t.Address)
    ])
    
    // Filter only active positions if needed
    return result || []
  } catch (error) {
    console.error('Failed to fetch borrowing positions:', error)
    return []
  }
}

/**
 * Format token amount for display
 */
export function formatTokenAmount(amount, decimals = 8) {
  if (!amount) return '0'
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  return num.toFixed(decimals)
}

/**
 * Format timestamp to readable date
 */
export function formatTimestamp(timestamp) {
  if (!timestamp) return '—'
  const date = new Date(parseFloat(timestamp) * 1000)
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
