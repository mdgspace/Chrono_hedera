import { Contract } from 'ethers';
import { config } from './index.js';

export const WRAPPED_TOKEN_FACTORY_ABI = [
  "function transferTokens(address token, address to, uint256 amount)"
];

export const LENDING_POOL_ABI = [
  "function getTotalDeposits(address token) view returns (uint256)",
  "function getTotalBorrowed(address token) view returns (uint256)"
];

export const ASSET_REGISTRY_ABI = [
  "function getConfig(address token) view returns (tuple(address tokenAddress, uint8 decimals, bool isStablecoin, uint256 ltvBase, uint256 ltvMax, uint256 kDecay, uint256 liquidationBonus, uint256 closeFactor, uint256 ltBufferMin, uint256 ltBufferMax, uint256 kLtBuffer, uint256 hardLiqPenalty, uint256 minBorrowDuration, uint256 maxBorrowDuration, bool isActive))",
  "function getAllAssets() view returns (address[])"
];

export const PYTH_ORACLE_ABI = [
  "function getPrice(address token) view returns (uint256)"
];

export const LIQUIDATION_ENGINE_ABI = [
  "event SoftLiquidation(bytes32 indexed positionId, address liquidator, uint256 debtRepaid, uint256 collateralSeized)",
  "event HardLiquidation(bytes32 indexed positionId, uint256 debtRepaid, uint256 collateralSeized)"
];

export const BORROW_VAULT_ABI = [
  "function nextPositionId() view returns (uint256)",
  "function getPosition(bytes32 positionId) view returns (tuple(bytes32 id, address borrower, address collateralToken, address debtToken, uint256 collateralAmount, uint256 borrowAmount, uint256 startTime, uint256 duration, address scheduledTxAddress, bool active))",
  "event PositionOpened(bytes32 indexed positionId, address indexed borrower, address collateralToken, address debtToken)",
  "event Repaid(bytes32 indexed positionId, uint256 amount)",
  "event CollateralToppedUp(bytes32 indexed positionId, uint256 amount)",
  "event ProtocolFeeCollected(bytes32 indexed positionId, address indexed treasury, uint256 amount)"
];

export const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)"
];

export const STABILITY_POOL_ABI = [
  "function depositScale(address debtToken) view returns (uint256)",
  "function totalScaledDeposits(address debtToken) view returns (uint256)",
  "function hasAbsorbedToken(address debtToken, address collateralToken) view returns (bool)",
  "function absorbedCollateralTokens(address debtToken, uint256 index) view returns (address)",
  "function canAbsorb(address debtToken, uint256 amount) view returns (bool)"
];

export const RISK_ENGINE_ABI = [
  "function computeHealthFactor(uint256 collValue, uint256 debtValue, address collateralToken, uint256 remainingDuration, uint256 timeSinceStart) view returns (uint256)"
];

export function getWrappedTokenFactory(signer) {
  return new Contract(config.addresses.WrappedTokenFactory, WRAPPED_TOKEN_FACTORY_ABI, signer);
}

export function getLendingPool(provider) {
  return new Contract(config.addresses.LendingPool, LENDING_POOL_ABI, provider);
}

export function getAssetRegistry(provider) {
  return new Contract(config.addresses.AssetRegistry, ASSET_REGISTRY_ABI, provider);
}

export function getPythOracle(provider) {
  return new Contract(config.addresses.PythOracleAdapter, PYTH_ORACLE_ABI, provider);
}

export function getLiquidationEngine(provider) {
  return new Contract(config.addresses.LiquidationEngine, LIQUIDATION_ENGINE_ABI, provider);
}

export function getBorrowVault(provider) {
  return new Contract(config.addresses.BorrowVault, BORROW_VAULT_ABI, provider);
}

export function getRiskEngine(provider) {
  return new Contract(config.addresses.RiskEngine, RISK_ENGINE_ABI, provider);
}

export function getStabilityPool(provider) {
  return new Contract(config.addresses.StabilityPool, STABILITY_POOL_ABI, provider);
}

export function getERC20(address, provider) {
  return new Contract(address, ERC20_ABI, provider);
}
