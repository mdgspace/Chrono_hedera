const VAULT_DATA_PATH = '/vault.json';
const BACKEND_API = 'http://localhost:3001';

import { getAllMockVaults } from './mockData';

/**
 * Fetch vault data from the backend
 * @returns {Promise<Object>} Updated vault data
 */
export async function fetchVaultDataFromBackend() {
  try {
    console.log('Requesting vault data from backend...');
    const response = await fetch(`${BACKEND_API}/api/v1/protocol/vault/data`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      console.warn('Backend fetch failed, returning empty');
      return { vaults: [], timestamp: new Date().toISOString() };
    }
    
    const result = await response.json();
    return result;
  } catch (error) {
    console.warn('Backend not available:', error.message);
    return { vaults: [], timestamp: new Date().toISOString() };
  }
}

/**
 * Fetch the latest vault data
 * @returns {Promise<Object>} Parsed vault data
 */
export async function fetchVaultData() {
  return await fetchVaultDataFromBackend();
}

export function formatUSD(value) {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

export function formatTokenAmount(value, symbol, decimals = 2) {
  const numValue = Number(value);
  if (numValue >= 1e6) return `${(numValue / 1e6).toFixed(decimals)}M ${symbol}`;
  if (numValue >= 1e3) return `${(numValue / 1e3).toFixed(decimals)}K ${symbol}`;
  return `${numValue.toFixed(decimals)} ${symbol}`;
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
      totalSupplyToken: formatTokenAmount(Number(vault.totalDeposited) / 1e8, vault.symbol),
      exposure: vault.numberOfActiveBorrowPositions,
      utilization: vault.utilizationRate.toFixed(2) + '%',
      utilizationPercent: vault.utilizationRate,
      totalBorrowed: formatUSD(vault.totalBorrowedUSD),
      totalBorrowedToken: formatTokenAmount(Number(vault.totalBorrowed) / 1e8, vault.symbol),
      availableLiquidity: formatUSD(vault.availableLiquidityUSD),
      availableLiquidityToken: formatTokenAmount(Number(vault.availableLiquidity) / 1e8, vault.symbol),
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
    .filter(vault => Number(vault.availableLiquidity) > 0)
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
        availableToken: formatTokenAmount(Number(vault.availableLiquidity) / 1e8, vault.symbol),
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

