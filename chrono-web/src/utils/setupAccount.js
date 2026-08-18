import { ethers } from 'ethers';
import { CONTRACTS } from './contracts';

const HTS_PRECOMPILE_ADDRESS = '0x0000000000000000000000000000000000000167';

const HTS_ABI = [
  "function associateTokens(address account, address[] memory tokens) external returns (int256 responseCode)"
];

export async function setupAccountTokens(signer, userAddress) {
  try {
    const response = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${userAddress}/tokens`);
    if (!response.ok) {
      console.warn('Failed to fetch associated tokens, skipping auto-associate');
      return;
    }
    
    const data = await response.json();
    const associatedTokenIds = data.tokens.map(t => t.token_id);
    
    const requiredTokens = [CONTRACTS.wUSDC, CONTRACTS.wETH, CONTRACTS.wBTC];
    const missingTokens = [];

    for (const token of requiredTokens) {
      if (!token) continue;
      // Convert EVM address to Hedera token ID string (e.g. 0.0.12345)
      const decimalId = parseInt(token, 16).toString();
      const tokenId = `0.0.${decimalId}`;
      
      if (!associatedTokenIds.includes(tokenId)) {
        missingTokens.push(token);
      }
    }

    if (missingTokens.length === 0) {
      console.log('All required tokens already associated.');
      return;
    }

    console.log(`Associating missing tokens:`, missingTokens);
    
    const htsContract = new ethers.Contract(HTS_PRECOMPILE_ADDRESS, HTS_ABI, signer);
    const tx = await htsContract.associateTokens(userAddress, missingTokens, { gasLimit: 2000000 });
    
    console.log(`Association TX sent: ${tx.hash}`);
    await tx.wait();
    console.log('Tokens successfully associated!');

  } catch (error) {
    console.error('Failed to setup account tokens:', error);
  }
}
