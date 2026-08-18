import { ethers } from 'ethers';
import { config } from '../config/index.js';
import { 
  getLendingPool, getAssetRegistry, getPythOracle, 
  getBorrowVault, getRiskEngine, getERC20 
} from '../config/contracts.js';

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
      price,
      totalDepositedUSD,
      totalBorrowedUSD,
      availableLiquidityUSD,
      numberOfActiveBorrowPositions: 0,
      numberOfActiveLendingPositions: 0
    });
  }

  const nextPosId = await borrowVault.nextPositionId();
  const numPositions = Number(nextPosId);
  const borrowStats = {};

  for (let i = 1; i < numPositions; i++) {
    const positionId = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const pos = await borrowVault.getPosition(positionId);
    
    if (pos.active) {
      activeBorrowingPositions++;
      
      const debtToken = pos.debtToken;
      if (!borrowStats[debtToken]) borrowStats[debtToken] = 0;
      borrowStats[debtToken]++;

      const now = Math.floor(Date.now() / 1000);
      const startTime = Number(pos.startTime);
      const duration = Number(pos.duration);
      
      if (now >= startTime + duration) {
        overduePositions++;
      }

      let collPriceWad = 0n;
      let debtPriceWad = 0n;
      try {
        collPriceWad = await oracle.getPrice(pos.collateralToken);
        debtPriceWad = await oracle.getPrice(pos.debtToken);
      } catch (e) {}

      const collValue = (pos.collateralAmount * collPriceWad) / 10n**18n;
      const debtValue = (pos.borrowAmount * debtPriceWad) / 10n**18n;

      const remainingDuration = (now < startTime + duration) ? (startTime + duration - now) : 0;
      const timeSinceStart = (now > startTime) ? (now - startTime) : 0;

      let hf = 10n**18n; // Default to borderline if oracle fails
      if (collPriceWad > 0n && debtPriceWad > 0n) {
        hf = await riskEngine.computeHealthFactor(
          collValue, debtValue, pos.collateralToken, 
          remainingDuration, timeSinceStart
        );
      }

      if (hf <= 10n**18n) {
        unhealthyPositions++;
      }
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
