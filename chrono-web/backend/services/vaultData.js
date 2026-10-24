import { ethers } from 'ethers';
import { config } from '../config/index.js';
import { 
  getLendingPool, getAssetRegistry, getPythOracle, 
  getBorrowVault, getRiskEngine, getInterestEngine, getERC20
} from '../config/contracts.js';
import { supabase } from '../db/supabase.js';

let vaultDataCache = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 30000;

export async function fetchVaultData() {
  if (vaultDataCache && (Date.now() - lastCacheTime < CACHE_TTL_MS)) {
    return vaultDataCache;
  }

  const provider = new ethers.JsonRpcProvider(config.HEDERA_TESTNET_RPC);
  const registry = getAssetRegistry(provider);
  const lendingPool = getLendingPool(provider);
  const oracle = getPythOracle(provider);
  const borrowVault = getBorrowVault(provider);
  const riskEngine = getRiskEngine(provider);
  const interestEngine = getInterestEngine(provider);

  const assets = await registry.getAllAssets();

  let totalValueLocked = 0n;
  let totalBorrowedAll = 0n;
  let activeLendingPositions = 0;
  let activeBorrowingPositions = 0;
  let unhealthyPositions = 0;
  let overduePositions = 0;

  const vaults = [];

  for (const asset of assets) {
    const erc20 = getERC20(asset, provider);
    const symbol = await erc20.symbol();
    const name = await erc20.name();
    const tokenConfig = await registry.getConfig(asset);
    
    const totalDeposited = await lendingPool.getTotalDeposits(asset);
    const totalBorrowed = await lendingPool.getTotalBorrowed(asset);
    const [borrowAPY, adaptiveRate, targetRate, supplyAPY] = await Promise.all([
      interestEngine.getBorrowAPY(asset),
      interestEngine.getAdaptiveRate(asset),
      interestEngine.getTargetRate(asset),
      interestEngine.getSupplyAPY(asset)
    ]);
    
    let priceWad = 0n;
    try {
      priceWad = await oracle.getPrice(asset);
    } catch (err) {
      console.warn(`Oracle feed not registered or error for ${symbol}: ${err.message}`);
    }
    
    const price = Number(ethers.formatUnits(priceWad, 18));
    const decimals = tokenConfig.decimals;

    const availableLiquidity = totalDeposited - totalBorrowed;
    
    const depositedFloat = Number(ethers.formatUnits(totalDeposited, decimals));
    const borrowedFloat = Number(ethers.formatUnits(totalBorrowed, decimals));
    const availableFloat = Number(ethers.formatUnits(availableLiquidity, decimals));

    const totalDepositedUSD = depositedFloat * price;
    const totalBorrowedUSD = borrowedFloat * price;
    const availableLiquidityUSD = availableFloat * price;

    const utilizationRate = totalDeposited > 0n 
      ? Number((totalBorrowed * 10000n) / totalDeposited) / 100 
      : 0;

    totalValueLocked += ethers.parseUnits(totalDepositedUSD.toFixed(18), 18);
    totalBorrowedAll += ethers.parseUnits(totalBorrowedUSD.toFixed(18), 18);

    vaults.push({
      symbol,
      name,
      tokenType: tokenConfig.isStablecoin ? 'stablecoin' : 'volatile',
      totalDeposited: totalDeposited.toString(),
      totalBorrowed: totalBorrowed.toString(),
      availableLiquidity: availableLiquidity.toString(),
      utilizationRate,
      borrowAPY: borrowAPY.toString(),
      adaptiveRate: adaptiveRate.toString(),
      targetRate: targetRate.toString(),
      fixedRateComponent: (borrowAPY - adaptiveRate).toString(),
      supplyAPY: supplyAPY.toString(),
      price,
      totalDepositedUSD,
      totalBorrowedUSD,
      availableLiquidityUSD,
      numberOfActiveBorrowPositions: 0,
      numberOfActiveLendingPositions: 0
    });
  }

  const borrowStats = {};
  let activePositions = [];

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('positions')
        .select('*')
        .eq('active', true);
      if (!error && data) {
        activePositions = data;
      }
    } catch (e) {
      console.warn("Could not query positions from Supabase:", e.message);
    }
  }

  activeBorrowingPositions = activePositions.length;
  const now = Math.floor(Date.now() / 1000);

  for (const pos of activePositions) {
    const debtToken = pos.debt_token;
    if (!borrowStats[debtToken]) borrowStats[debtToken] = 0;
    borrowStats[debtToken]++;

    const startTime = Number(pos.start_time);
    const duration = Number(pos.duration);

    if (now >= startTime + duration) {
      overduePositions++;
    }

    let collPriceWad = 0n;
    let debtPriceWad = 0n;
    try {
      collPriceWad = await oracle.getPrice(pos.collateral_token);
      debtPriceWad = await oracle.getPrice(pos.debt_token);
    } catch (e) {}

    const collValue = (BigInt(pos.collateral_amount) * collPriceWad) / 10n**18n;
    let debtAmount = BigInt(pos.borrow_amount);
    try {
      debtAmount = await interestEngine.previewTotalDebt(pos.position_id);
    } catch (e) {
      console.warn(`Debt preview unavailable for ${pos.position_id}: ${e.message}`);
    }
    const debtValue = (debtAmount * debtPriceWad) / 10n**18n;

    let hf = 10n**18n; // Default to borderline if oracle fails
    if (collPriceWad > 0n && debtPriceWad > 0n) {
      try {
        hf = await riskEngine.computeHealthFactor(
          collValue, debtValue, pos.collateral_token,
          pos.debt_token, duration
        );
      } catch (e) {}
    }

    if (hf <= 10n**18n) {
      unhealthyPositions++;
    }
  }

  for (const v of vaults) {
    const assetObj = assets[vaults.indexOf(v)];
    v.numberOfActiveBorrowPositions = borrowStats[assetObj] || 0;
  }

  vaultDataCache = {
    timestamp: new Date().toISOString(),
    protocolStats: {
      totalValueLocked: Number(ethers.formatUnits(totalValueLocked, 18)),
      totalBorrowed: Number(ethers.formatUnits(totalBorrowedAll, 18)),
      activeLendingPositions,
      activeBorrowingPositions,
      unhealthyPositions,
      overduePositions
    },
    vaults
  };

  lastCacheTime = Date.now();
  return vaultDataCache;
}
