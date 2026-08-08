// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/ILendingPool.sol";
import "../interfaces/IAssetRegistry.sol";
import "../libraries/ErrorLib.sol";

contract LendingPool is ILendingPool, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IAssetRegistry public assetRegistry;

    // token => totalBorrowed
    mapping(address => uint256) public totalBorrowed;
    
    // token => totalShares
    mapping(address => uint256) public totalShares;

    // user => token => shares
    mapping(address => mapping(address => uint256)) public userShares;

    // caller => authorized
    mapping(address => bool) public isAuthorized;

    event AuthorizedSet(address indexed caller, bool authorized);
    event Deposited(address indexed user, address indexed token, uint256 amount, uint256 shares);
    event Withdrawn(address indexed user, address indexed token, uint256 amount, uint256 shares);

    modifier onlyAuthorized() {
        if (!isAuthorized[msg.sender]) {
            revert ErrorLib.Unauthorized(msg.sender, address(0));
        }
        _;
    }

    constructor(address _assetRegistry, address initialOwner) Ownable(initialOwner) {
        assetRegistry = IAssetRegistry(_assetRegistry);
    }

    function setAuthorized(address caller, bool authorized) external onlyOwner {
        isAuthorized[caller] = authorized;
        emit AuthorizedSet(caller, authorized);
    }

    function reserveBorrowLiquidity(address token, uint256 amount) external onlyAuthorized {
        if (amount == 0) revert ErrorLib.ZeroAmount();
        
        uint256 available = IERC20(token).balanceOf(address(this));
        if (amount > available) revert ErrorLib.InsufficientLiquidity(token, available, amount);
        
        totalBorrowed[token] += amount;
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    function returnBorrowLiquidity(address token, uint256 amount) external onlyAuthorized {
        if (amount == 0) revert ErrorLib.ZeroAmount();
        totalBorrowed[token] -= amount;
    }

    function deposit(address token, uint256 amount) external nonReentrant returns (uint256 shares) {
        if (amount == 0) revert ErrorLib.ZeroAmount();
        if (!assetRegistry.isSupported(token)) revert ErrorLib.AssetNotSupported(token);

        uint256 _totalDeposits = getTotalDeposits(token);
        uint256 _totalShares = totalShares[token];

        if (_totalShares == 0 || _totalDeposits == 0) {
            shares = amount;
        } else {
            shares = (amount * _totalShares) / _totalDeposits;
        }
        
        if (shares == 0) revert ErrorLib.ZeroAmount(); // Avoid dust attack returning 0 shares

        totalShares[token] += shares;
        userShares[msg.sender][token] += shares;

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        emit Deposited(msg.sender, token, amount, shares);
    }

    function withdraw(address token, uint256 shares) external nonReentrant returns (uint256 amount) {
        if (shares == 0) revert ErrorLib.ZeroAmount();
        if (userShares[msg.sender][token] < shares) revert ErrorLib.InsufficientBalance(msg.sender, shares, userShares[msg.sender][token]);

        uint256 _totalDeposits = getTotalDeposits(token);
        uint256 _totalShares = totalShares[token];

        amount = (shares * _totalDeposits) / _totalShares;
        
        if (amount == 0) revert ErrorLib.ZeroAmount();

        uint256 available = IERC20(token).balanceOf(address(this));
        if (amount > available) revert ErrorLib.InsufficientLiquidity(token, available, amount);

        totalShares[token] -= shares;
        userShares[msg.sender][token] -= shares;

        IERC20(token).safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, token, amount, shares);
    }

    function getTotalBorrowed(address token) external view returns (uint256) {
        return totalBorrowed[token];
    }

    function getTotalDeposits(address token) public view returns (uint256) {
        return IERC20(token).balanceOf(address(this)) + totalBorrowed[token];
    }
}
