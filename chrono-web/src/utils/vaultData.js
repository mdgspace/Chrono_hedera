const VAULT_DATA_PATH = '/vault.json';
const BACKEND_API = 'http://localhost:3001';

/**
 * Trigger vault data update on the backend
 * @returns {Promise<Object>} Updated vault data
 */
export async function updateVaultDataFromBackend() {
  try {
    console.log('Requesting vault data update from backend...');
    const response = await fetch(`${BACKEND_API}/api/vault/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      console.warn('Backend update failed, will use cached data');
      return null;
    }
    
    const result = await response.json();
    console.log('Vault data updated successfully');
    return result.data;
  } catch (error) {
    console.warn('Backend not available, will use cached vault data:', error.message);
    return null;
  }
}

/**
 * Fetch the latest vault data from the JSON file
 * @returns {Promise<Object>} Parsed vault data
 */
export async function fetchVaultData() {
  try {
    const response = await fetch(VAULT_DATA_PATH + '?t=' + Date.now());
    if (!response.ok) throw new Error(`Failed to fetch vault data: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error('Error fetching vault data:', error);
    throw error;
  }
}

export function formatUSD(value) {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

export function formatTokenAmount(value, symbol, decimals = 2) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(decimals)}M ${symbol}`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(decimals)}K ${symbol}`;
  return `${value.toFixed(decimals)} ${symbol}`;
}

/**
 * Euler-style Linear Kink IRM Parameters
 */
const baseRate = 0.02;     // 2%
const kink = 0.8;          // 80% utilization
const slope1 = 0.08;       // 8% slope before kink
const slope2 = 1.0;        // 100% slope after kink
const reserveFactor = 0.1; // 10% reserve

/**
 * Calculate borrow APY based on utilization rate
 */
export function calculateBorrowAPY(utilizationRate) {
  const u = utilizationRate / 100;
  let rate;
  if (u <= kink) rate = baseRate + slope1 * u;
  else rate = baseRate + slope1 * kink + slope2 * (u - kink);
  return (rate * 100).toFixed(2) + '%';
}

/**
 * Calculate supply APY based on borrow APY and utilization
 */
export function calculateSupplyAPY(borrowAPY, utilizationRate) {
  const borrowRate = parseFloat(borrowAPY) / 100;
  const u = utilizationRate / 100;
  const supplyRate = borrowRate * u * (1 - reserveFactor);
  return (supplyRate * 100).toFixed(2) + '%';
}

/**
 * Get vault by token symbol
 */
export function getVaultBySymbol(vaults, symbol) {
  return vaults.find(vault => vault.symbol === symbol);
}

/**
 * Check if vault data is stale (older than 4 hours)
 */
export function isDataStale(timestamp) {
  const dataAge = Date.now() - new Date(timestamp).getTime();
  return dataAge > 4 * 60 * 60 * 1000;
}

/**
 * Transform vault data for the Lend view
 */
export function transformForLendView(vaultData) {
  if (!vaultData || !vaultData.vaults) return [];

  return vaultData.vaults.map(vault => {
    const borrowAPY = calculateBorrowAPY(vault.utilizationRate);
    const supplyAPY = calculateSupplyAPY(borrowAPY, vault.utilizationRate);
    
    return {
      name: vault.name,
      symbol: vault.symbol,
      protocol: 'Chrono',
      supplyAPY,
      totalSupply: formatUSD(vault.totalDepositedUSD),
      totalSupplyToken: formatTokenAmount(vault.totalDeposited, vault.symbol),
      exposure: vault.numberOfActiveBorrowPositions,
      utilization: vault.utilizationRate.toFixed(2) + '%',
      utilizationPercent: vault.utilizationRate,
      totalBorrowed: formatUSD(vault.totalBorrowedUSD),
      totalBorrowedToken: formatTokenAmount(vault.totalBorrowed, vault.symbol),
      availableLiquidity: formatUSD(vault.availableLiquidityUSD),
      availableLiquidityToken: formatTokenAmount(vault.availableLiquidity, vault.symbol),
      borrowAPY,
      price: vault.price
    };
  });
}

/**
 * Transform vault data for the Borrow view
 */
export function transformForBorrowView(vaultData) {
  if (!vaultData || !vaultData.vaults) return [];

  return vaultData.vaults
    .filter(vault => vault.availableLiquidity > 0)
    .map(vault => {
      const borrowAPY = calculateBorrowAPY(vault.utilizationRate);
      const supplyAPY = calculateSupplyAPY(borrowAPY, vault.utilizationRate);
      return {
        name: vault.name,
        symbol: vault.symbol,
        protocol: 'Chrono',
        borrowAPY,
        supplyAPY,
        available: formatUSD(vault.availableLiquidityUSD),
        availableToken: formatTokenAmount(vault.availableLiquidity, vault.symbol),
        maxLTV: '75%',
        liquidationThreshold: '85%',
        price: vault.price,
        utilization: vault.utilizationRate
      };
    });
}

/**
 * Get protocol-wide statistics
 */
export function getProtocolStats(vaultData) {
  if (!vaultData || !vaultData.protocolStats) return null;
  const stats = vaultData.protocolStats;

  return {
    totalValueLocked: formatUSD(stats.totalValueLocked),
    totalBorrowed: formatUSD(stats.totalBorrowed),
    activeLendingPositions: stats.activeLendingPositions,
    activeBorrowingPositions: stats.activeBorrowingPositions,
    unhealthyPositions: stats.unhealthyPositions,
    overduePositions: stats.overduePositions,
    lastUpdate: vaultData.timestamp
  };
}

