import { getMockPoolData } from './mockData';

const BACKEND_API = 'http://localhost:3001';

export async function fetchPoolData() {
  try {
    const res = await fetch(`${BACKEND_API}/api/v1/pool/stability`);
    if (res.ok) {
      const data = await res.json();
      return data;
    }
  } catch (err) {
    console.warn("Could not fetch stability pool from backend, using fallback:", err.message);
  }

  return {
    totalShares: "15,234",
    totalUSDCLiquidity: "$2,500,000",
    totalETHLiquidity: "1,245 ETH",
    totalHBARLiquidity: "500,000 HBAR",
    totalContributors: "342",
    pendingHBARRewards: "12,500 HBAR",
    collateralETHBalance: "500 ETH",
    collateralUSDCBalance: "$1,200,000"
  };
}


