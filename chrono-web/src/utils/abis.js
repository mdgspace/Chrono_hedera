export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

export const CHRONO_ROUTER_ABI = [
  "function openPosition(address collateralToken, address debtToken, uint256 collateralAmount, uint256 borrowAmount, uint256 durationSeconds) returns (bytes32 positionId)",
  "function deposit(address token, uint256 amount) returns (uint256 shares)",
  "function repay(bytes32 positionId, uint256 amount)"
];

export const BORROW_VAULT_ABI = [
  "function getPosition(bytes32 positionId) view returns (tuple(bytes32 id, address borrower, address collateralToken, address debtToken, uint256 collateralAmount, uint256 borrowAmount, uint256 startTime, uint256 duration, address scheduledTxAddress, bool active))",
  "function topUpCollateral(bytes32 positionId, uint256 amount)",
  "function nextPositionId() view returns (uint256)",
  "event PositionOpened(bytes32 indexed positionId, address indexed borrower, address collateralToken, address debtToken)"
];

export const LENDING_POOL_ABI = [
  "function withdraw(address token, uint256 shares) returns (uint256 amount)",
  "function userShares(address user, address token) view returns (uint256)",
  "function totalShares(address token) view returns (uint256)",
  "function getTotalDeposits(address token) view returns (uint256)",
  "function getTotalBorrowed(address token) view returns (uint256)"
];

export const STABILITY_POOL_ABI = [
  "function deposit(address debtToken, uint256 amount)",
  "function withdraw(address debtToken, uint256 amount)",
  "function claimCollateralRewards(address debtToken)",
  "function providerScaledDeposits(address debtToken, address provider) view returns (uint256)"
];

export const INTEREST_ENGINE_ABI = [
  "function getUtilization(address token) view returns (uint256)",
  "function getBorrowAPY(address token) view returns (uint256)",
  "function getSupplyAPY(address token) view returns (uint256)"
];

export const ASSET_REGISTRY_ABI = [
  "function getConfig(address token) view returns (tuple(address tokenAddress, uint8 decimals, bool isStablecoin, uint256 ltvBase, uint256 ltvMax, uint256 kDecay, uint256 liquidationBonus, uint256 closeFactor, uint256 ltBufferMin, uint256 ltBufferMax, uint256 kLtBuffer, uint256 hardLiqPenalty, uint256 hardLiqCollateralFloor, uint256 stabilityPoolPenaltyShare, uint256 reservePenaltyShare, uint256 minBorrowDuration, uint256 maxBorrowDuration, bool isActive))",
  "function getAllAssets() view returns (address[])",
  "function isSupported(address token) view returns (bool)"
];
