export const mockVaultData = {
  wUSDC: {
    symbol: 'wUSDC',
    name: 'Wrapped USDC',
    price: 1.00,
    decimals: 8,
    totalDeposits: 2500000,
    totalBorrows: 1500000,
    utilizationRate: 0.60,
    borrowApy: 0.08,
    lendApy: 0.05,
    maxLtv: 0.90
  },
  wETH: {
    symbol: 'wETH',
    name: 'Wrapped ETH',
    price: 3000.00,
    decimals: 8,
    totalDeposits: 500,
    totalBorrows: 200,
    utilizationRate: 0.40,
    borrowApy: 0.06,
    lendApy: 0.03,
    maxLtv: 0.85
  },
  wBTC: {
    symbol: 'wBTC',
    name: 'Wrapped BTC',
    price: 65000.00,
    decimals: 8,
    totalDeposits: 50,
    totalBorrows: 10,
    utilizationRate: 0.20,
    borrowApy: 0.04,
    lendApy: 0.015,
    maxLtv: 0.80
  }
};

export const mockPoolData = {
  wUSDC: {
    symbol: 'wUSDC',
    totalDeposits: 500000,
    apy: 0.12,
    apr: 0.11,
    rewards: [
      { symbol: 'wETH', amount: 0.5 },
      { symbol: 'wBTC', amount: 0.01 }
    ]
  },
  wETH: {
    symbol: 'wETH',
    totalDeposits: 100,
    apy: 0.08,
    apr: 0.075,
    rewards: [
      { symbol: 'wUSDC', amount: 5000 },
      { symbol: 'wBTC', amount: 0.02 }
    ]
  }
};

export function getMockVaultData(symbol) {
  return mockVaultData[symbol] || null;
}

export function getAllMockVaults() {
  return Object.values(mockVaultData);
}

export function getMockPoolData(symbol) {
  return mockPoolData[symbol] || null;
}
