import { ethers } from 'ethers';
import { config } from '../config/index.js';
import { 
  getStabilityPool, getAssetRegistry, getPythOracle, getERC20 
} from '../config/contracts.js';

let stabilityCache = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 30000;

export async function fetchStabilityPoolData() {
  if (stabilityCache && (Date.now() - lastCacheTime < CACHE_TTL_MS)) {
    return stabilityCache;
  }

  const provider = new ethers.JsonRpcProvider(config.HEDERA_TESTNET_RPC);
  const stabilityPool = getStabilityPool(provider);
  const registry = getAssetRegistry(provider);
  const oracle = getPythOracle(provider);
  const stabilityPoolAddress = config.addresses.StabilityPool;

  const assets = await registry.getAllAssets();
  const pools = [];
  let totalDepositedAllUSD = 0;

  let totalUSDCLiquidityNum = 0;
  let totalETHLiquidityNum = 0;
  let totalHBARLiquidityNum = 0;
  let totalSharesNum = 0;

  for (const debtToken of assets) {
    try {
      const tokenContract = getERC20(debtToken, provider);
      let symbol = "UNKNOWN";
      let decimals = 18;
      try {
        symbol = await tokenContract.symbol();
        decimals = Number(await tokenContract.decimals());
      } catch (e) {}

      let scale = 10n**18n;
      let scaledDeposits = 0n;
      try {
        scale = await stabilityPool.depositScale(debtToken);
        if (scale === 0n) scale = 10n**18n;
        scaledDeposits = await stabilityPool.totalScaledDeposits(debtToken);
      } catch (e) {}

      const totalDepositedRaw = (scaledDeposits * scale) / 10n**18n;
      const totalDeposited = Number(ethers.formatUnits(totalDepositedRaw, decimals));

      let contractBalanceRaw = 0n;
      try {
        contractBalanceRaw = await tokenContract.balanceOf(stabilityPoolAddress);
      } catch (e) {}
      const contractBalance = Number(ethers.formatUnits(contractBalanceRaw, decimals));

      let priceWad = 0n;
      try {
        priceWad = await oracle.getPrice(debtToken);
      } catch (e) {}
      const priceUSD = Number(ethers.formatUnits(priceWad, 18));
      const totalDepositedUSD = totalDeposited * priceUSD;
      totalDepositedAllUSD += totalDepositedUSD;

      if (symbol.toUpperCase().includes('USDC')) {
        totalUSDCLiquidityNum += totalDeposited;
        totalSharesNum += Number(ethers.formatUnits(scaledDeposits, decimals));
      } else if (symbol.toUpperCase().includes('ETH')) {
        totalETHLiquidityNum += totalDeposited;
      } else if (symbol.toUpperCase().includes('HBAR')) {
        totalHBARLiquidityNum += totalDeposited;
      }

      // Query absorbed collateral tokens
      const absorbedTokens = [];
      for (const collToken of assets) {
        if (collToken.toLowerCase() === debtToken.toLowerCase()) continue;
        try {
          const isAbsorbed = await stabilityPool.hasAbsorbedToken(debtToken, collToken);
          if (isAbsorbed) {
            const collContract = getERC20(collToken, provider);
            const collSymbol = await collContract.symbol();
            const collDecimals = Number(await collContract.decimals());
            const collBalanceRaw = await collContract.balanceOf(stabilityPoolAddress);
            const collBalance = Number(ethers.formatUnits(collBalanceRaw, collDecimals));
            absorbedTokens.push({
              token: collToken,
              symbol: collSymbol,
              balance: collBalance,
              balanceRaw: collBalanceRaw.toString()
            });
          }
        } catch (e) {}
      }

      pools.push({
        debtToken,
        symbol,
        decimals,
        totalScaledDeposits: scaledDeposits.toString(),
        depositScale: scale.toString(),
        totalDeposited,
        totalDepositedRaw: totalDepositedRaw.toString(),
        totalDepositedUSD,
        contractBalance,
        absorbedCollateralTokens: absorbedTokens
      });
    } catch (err) {
      console.warn(`Error fetching stability pool for ${debtToken}:`, err.message);
    }
  }

  stabilityCache = {
    timestamp: new Date().toISOString(),
    stabilityPoolAddress,
    totalDepositedUSD: totalDepositedAllUSD,
    totalShares: totalSharesNum > 0 ? totalSharesNum.toLocaleString() : "0",
    totalUSDCLiquidity: `$${totalUSDCLiquidityNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    totalETHLiquidity: `${totalETHLiquidityNum.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ETH`,
    totalHBARLiquidity: `${totalHBARLiquidityNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} HBAR`,
    totalContributors: "0",
    pendingHBARRewards: "0 HBAR",
    collateralETHBalance: "0 ETH",
    collateralUSDCBalance: "$0.00",
    pools
  };
  lastCacheTime = Date.now();
  return stabilityCache;
}
