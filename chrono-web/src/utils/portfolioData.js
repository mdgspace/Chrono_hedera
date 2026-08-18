import { ethers } from 'ethers';
import { CONTRACTS } from './contracts';
import { BORROW_VAULT_ABI, LENDING_POOL_ABI, STABILITY_POOL_ABI, ASSET_REGISTRY_ABI } from './abis';

const addressToSymbol = Object.entries(CONTRACTS).reduce((acc, [key, val]) => {
  if (typeof val === 'string' && val.startsWith('0x')) {
    acc[val.toLowerCase()] = key;
  }
  return acc;
}, {});

/**
 * Fetch user's borrowing positions
 */
export async function fetchUserBorrowingPositions(signer, userAddress) {
  try {
    if (!userAddress || !signer) return [];

    const borrowVault = new ethers.Contract(CONTRACTS.BorrowVault, BORROW_VAULT_ABI, signer);

    const nextId = await borrowVault.nextPositionId();
    const maxId = Number(nextId);

    const positions = [];
    for (let i = 1; i < maxId; i++) {
      const positionId = ethers.zeroPadValue(ethers.toBeHex(i), 32);
      try {
        const p = await borrowVault.getPosition(positionId);
        // p.borrower is the user
        if (p.borrower.toLowerCase() === userAddress.toLowerCase()) {
          const cSymbol = addressToSymbol[p.collateralToken.toLowerCase()] || 'Token';
          const dSymbol = addressToSymbol[p.debtToken.toLowerCase()] || 'Token';

          positions.push({
            id: i, // parsed integer ID
            fullId: positionId, // original hex string needed for smart contract calls
            collateralToken: p.collateralToken,
            debtToken: p.debtToken,
            collateralType: cSymbol,
            borrowTokenType: dSymbol,
            collateralAmount: ethers.formatUnits(p.collateralAmount, 8),
            borrowAmount: ethers.formatUnits(p.borrowAmount, 8),
            startTime: p.startTime.toString(),
            timestamp: p.startTime.toString(),
            duration: p.duration.toString(),
            durationMinutes: (Number(p.duration) / 60).toString(),
            repaymentDeadline: (Number(p.startTime) + Number(p.duration)).toString(),
            isActive: p.active
          });
        }
      } catch (e) {
        // Position might not exist or failed to load
        console.warn(`Failed to load position ${i}`, e);
      }
    }
    return positions;
  } catch (error) {
    console.error('Failed to fetch borrowing positions:', error);
    return [];
  }
}

/**
 * Fetch user's lending positions
 */
export async function fetchUserLendingPositions(signer, userAddress) {
  try {
    if (!userAddress || !signer) return [];

    const registry = new ethers.Contract(CONTRACTS.AssetRegistry, ASSET_REGISTRY_ABI, signer);
    const lendingPool = new ethers.Contract(CONTRACTS.LendingPool, LENDING_POOL_ABI, signer);

    const assets = await registry.getAllAssets();

    const positions = [];
    for (const asset of assets) {
      const shares = await lendingPool.userShares(userAddress, asset);
      if (shares > 0n) {
        const totalShares = await lendingPool.totalShares(asset);
        const totalDeposits = await lendingPool.getTotalDeposits(asset);

        // Calculate underlying amount
        const amount = (shares * totalDeposits) / totalShares;
        const cSymbol = addressToSymbol[asset.toLowerCase()] || 'Token';

        positions.push({
          token: cSymbol,
          tokenAddress: asset,
          shares: ethers.formatUnits(shares, 8),
          amount: ethers.formatUnits(amount, 8),
          isActive: true,
          timestamp: Date.now() / 1000 // Just use current time for display
        });
      }
    }
    return positions;
  } catch (error) {
    console.error('Failed to fetch lending positions:', error);
    return [];
  }
}

/**
 * Fetch user's Stability Pool positions
 */
export async function fetchUserSPPositions(signer, userAddress) {
  try {
    if (!userAddress || !signer) return [];

    const registry = new ethers.Contract(CONTRACTS.AssetRegistry, ASSET_REGISTRY_ABI, signer);
    const stabilityPool = new ethers.Contract(CONTRACTS.StabilityPool, STABILITY_POOL_ABI, signer);

    const assets = await registry.getAllAssets();

    const positions = [];
    for (const asset of assets) {
      const config = await registry.getConfig(asset);
      if (config.isStablecoin) {
        const deposited = await stabilityPool.providerScaledDeposits(asset, userAddress);
        if (deposited > 0n) {
          const cSymbol = addressToSymbol[asset.toLowerCase()] || 'Token';
          positions.push({
            token: cSymbol,
            tokenAddress: asset,
            amount: ethers.formatUnits(deposited, 8),
            isActive: true,
            timestamp: Date.now() / 1000
          });
        }
      }
    }
    return positions;
  } catch (error) {
    console.error('Failed to fetch SP positions:', error);
    return [];
  }
}

/**
 * Format token amount for display
 */
export function formatTokenAmount(amount, decimals = 8) {
  if (!amount) return '0';
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return num.toFixed(decimals);
}

/**
 * Format timestamp to readable date
 */
export function formatTimestamp(timestamp) {
  if (!timestamp) return '—';
  const date = new Date(parseFloat(timestamp) * 1000);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
