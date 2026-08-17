import express from 'express';
import cors from 'cors';
import * as fcl from '@onflow/fcl';
import { config } from '@onflow/fcl';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import pkg from 'elliptic';
const { ec: EC } = pkg;

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Configure FCL for testnet
config({
  'accessNode.api': 'https://rest-testnet.onflow.org',
  'discovery.wallet': 'https://fcl-discovery.onflow.org/testnet/authn',
  'flow.network': 'testnet'
});

// Load the testnet account private key
const TESTNET_ADDRESS = '0xe11cab85e85ae137';
const TESTNET_PRIVATE_KEY = fs.readFileSync(
  path.resolve(__dirname, '../../raptor.pkey'),
  'utf8'
).trim();

// Read the ethMint.cdc transaction
const ethMintTransaction = fs.readFileSync(
  path.resolve(__dirname, '../../cadence/transactions/ethMint.cdc'),
  'utf8'
);

// Authorization function for the testnet account
const authorizationFunction = (account) => {
  return {
    ...account,
    tempId: `${TESTNET_ADDRESS}-${account.keyId}`,
    addr: fcl.sansPrefix(TESTNET_ADDRESS),
    keyId: Number(account.keyId),
    signingFunction: (signable) => {
      return {
        addr: fcl.withPrefix(TESTNET_ADDRESS),
        keyId: Number(account.keyId),
        signature: sign(signable.message)
      };
    }
  };
};

// Simple signing function using the private key
const sign = (message) => {
  try {
    const ec = new EC('p256');
    const key = ec.keyFromPrivate(Buffer.from(TESTNET_PRIVATE_KEY, 'hex'));
    
    // Hash the message
    const hash = require('crypto')
      .createHash('sha256')
      .update(Buffer.from(message, 'hex'))
      .digest();
    
    // Sign the hash
    const sig = key.sign(hash);
    const n = 32;
    const r = sig.r.toArrayLike(Buffer, 'be', n);
    const s = sig.s.toArrayLike(Buffer, 'be', n);
    
    return Buffer.concat([r, s]).toString('hex');
  } catch (error) {
    console.error('Signing error:', error);
    throw error;
  }
};

// ==================== VAULT DATA FUNCTIONS ====================

/**
 * Get token symbol from token type
 */
function getTokenSymbol(tokenType) {
  const symbolMap = {
    'WrappedETH': 'WETH',
    'WrappedUSDC': 'USDC',
    'FlowToken': 'FLOW'
  };
  return symbolMap[tokenType] || tokenType;
}

/**
 * Get token name from token type
 */
function getTokenName(tokenType) {
  const nameMap = {
    'WrappedETH': 'Wrapped ETH',
    'WrappedUSDC': 'USDC',
    'FlowToken': 'FLOW'
  };
  return nameMap[tokenType] || tokenType;
}

/**
 * Parse the Flow script output and convert it to clean JSON
 */
function parseFlowOutput(rawOutput) {
  try {
    // Remove ANSI color codes and clean up the output
    let cleaned = rawOutput
      .replace(/\x1B\[[0-9;]*[mGKH]/g, '') // Remove ANSI codes
      .trim();

    // Extract vault infos array
    const vaultInfoRegex = /VaultInfo\(tokenType:\s*"([^"]+)",\s*totalDeposited:\s*([\d.]+),\s*totalBorrowed:\s*([\d.]+),\s*availableLiquidity:\s*([\d.]+),\s*utilizationRate:\s*([\d.]+),\s*numberOfActiveBorrowPositions:\s*(\d+),\s*numberOfActiveLendingPositions:\s*(\d+),\s*price:\s*([\d.]+),\s*lastPriceUpdate:\s*([\d.]+)\)/g;
    
    const vaults = [];
    let match;
    
    while ((match = vaultInfoRegex.exec(cleaned)) !== null) {
      vaults.push({
        tokenType: match[1],
        totalDeposited: parseFloat(match[2]),
        totalBorrowed: parseFloat(match[3]),
        availableLiquidity: parseFloat(match[4]),
        utilizationRate: parseFloat(match[5]),
        numberOfActiveBorrowPositions: parseInt(match[6]),
        numberOfActiveLendingPositions: parseInt(match[7]),
        price: parseFloat(match[8]),
        lastPriceUpdate: parseFloat(match[9])
      });
    }

    // Extract protocol stats
    const protocolStatsRegex = /activeLendingPositions:\s*(\d+),\s*activeBorrowingPositions:\s*(\d+),\s*unhealthyPositions:\s*(\d+),\s*overduePositions:\s*(\d+)/;
    const statsMatch = cleaned.match(protocolStatsRegex);
    
    let activeLendingPositions = 0;
    let activeBorrowingPositions = 0;
    let unhealthyPositions = 0;
    let overduePositions = 0;
    
    if (statsMatch) {
      activeLendingPositions = parseInt(statsMatch[1]);
      activeBorrowingPositions = parseInt(statsMatch[2]);
      unhealthyPositions = parseInt(statsMatch[3]);
      overduePositions = parseInt(statsMatch[4]);
    }

    // Calculate total TVL and total borrowed in USD
    let totalValueLocked = 0;
    let totalBorrowedUSD = 0;
    
    vaults.forEach(vault => {
      totalValueLocked += vault.totalDeposited * vault.price;
      totalBorrowedUSD += vault.totalBorrowed * vault.price;
    });

    const result = {
      timestamp: new Date().toISOString(),
      lastUpdate: Date.now(),
      protocolStats: {
        totalValueLocked,
        totalBorrowed: totalBorrowedUSD,
        activeLendingPositions,
        activeBorrowingPositions,
        unhealthyPositions,
        overduePositions
      },
      vaults: vaults.map(vault => ({
        ...vault,
        // Add computed fields for easy display
        totalDepositedUSD: vault.totalDeposited * vault.price,
        totalBorrowedUSD: vault.totalBorrowed * vault.price,
        availableLiquidityUSD: vault.availableLiquidity * vault.price,
        // Map token names to symbols
        symbol: getTokenSymbol(vault.tokenType),
        name: getTokenName(vault.tokenType)
      }))
    };

    return result;
  } catch (error) {
    console.error('Error parsing Flow output:', error);
    throw error;
  }
}

/**
 * Execute the Flow script and get vault data
 */
async function fetchVaultData() {
  const scriptPath = path.resolve(__dirname, '../../cadence/scripts/vaultDataScript.cdc');
  const command = `flow scripts execute ${scriptPath} --network testnet`;
  
  console.log(`Executing: ${command}`);
  
  const { stdout, stderr } = await execAsync(command, { 
    maxBuffer: 1024 * 1024 * 10,
    cwd: path.resolve(__dirname, '../..')
  });
  
  if (stderr) {
    console.warn('Flow script warnings:', stderr);
  }
  
  console.log('Flow script executed successfully');
  return stdout;
}

/**
 * Update vault data and save to file
 */
async function updateVaultData() {
  try {
    console.log('Updating vault data...');
    
    // Fetch data from Flow
    const rawOutput = await fetchVaultData();
    
    // Parse the output
    const parsedData = parseFlowOutput(rawOutput);
    
    // Save to JSON file
    const outputPath = path.resolve(__dirname, '../public/vault.json');
    fs.writeFileSync(outputPath, JSON.stringify(parsedData, null, 2));
    
    console.log('Vault data updated successfully!');
    console.log(`Total Value Locked: $${parsedData.protocolStats.totalValueLocked.toFixed(2)}`);
    
    return parsedData;
  } catch (error) {
    console.error('Failed to update vault data:', error);
    throw error;
  }
}

// ==================== API ENDPOINTS ====================

/**
 * Faucet endpoint - Mints 100 WETH to user address
 */
app.post('/api/faucet', async (req, res) => {
  try {
    const { address } = req.body;
    
    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }

    console.log(`Minting 100 WETH to ${address}...`);

    // Execute the mint transaction
    const txId = await fcl.mutate({
      cadence: ethMintTransaction,
      args: (arg, t) => [
        arg('100.0', t.UFix64),  // amount
        arg(address, t.Address)   // recipient
      ],
      proposer: authorizationFunction,
      payer: authorizationFunction,
      authorizations: [authorizationFunction],
      limit: 9999
    });

    console.log(`Transaction sent: ${txId}`);

    // Wait for transaction to be sealed
    const txStatus = await fcl.tx(txId).onceSealed();
    console.log('Transaction sealed:', txStatus);

    return res.json({
      success: true,
      transactionId: txId,
      message: 'Successfully minted 100 WETH!'
    });

  } catch (error) {
    console.error('Faucet error:', error);
    return res.status(500).json({
      error: 'Failed to mint tokens',
      details: error.message
    });
  }
});

/**
 * Update vault data endpoint
 */
app.post('/api/vault/update', async (req, res) => {
  try {
    const vaultData = await updateVaultData();
    return res.json({
      success: true,
      data: vaultData,
      message: 'Vault data updated successfully'
    });
  } catch (error) {
    console.error('Vault update error:', error);
    return res.status(500).json({
      error: 'Failed to update vault data',
      details: error.message
    });
  }
});

/**
 * Get vault data endpoint
 */
app.get('/api/vault/data', async (req, res) => {
  try {
    const vaultFilePath = path.resolve(__dirname, '../public/vault.json');
    
    // Check if file exists
    if (!fs.existsSync(vaultFilePath)) {
      console.log('Vault file not found, updating...');
      const vaultData = await updateVaultData();
      return res.json(vaultData);
    }
    
    // Read existing file
    const fileContent = fs.readFileSync(vaultFilePath, 'utf8');
    const vaultData = JSON.parse(fileContent);
    
    return res.json(vaultData);
  } catch (error) {
    console.error('Error reading vault data:', error);
    return res.status(500).json({
      error: 'Failed to read vault data',
      details: error.message
    });
  }
});

/**
 * Get user supply by token endpoint
 */
app.get('/api/user/supply/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }

    // Ensure address has 0x prefix for Flow
    const flowAddress = address.startsWith('0x') ? address : `0x${address}`;
    
    const scriptPath = path.resolve(__dirname, '../../cadence/scripts/getUserSupplyByToken.cdc');
    const command = `flow scripts execute ${scriptPath} ${flowAddress} --network testnet`;
    
    console.log(`Executing: ${command}`);
    
    const { stdout, stderr } = await execAsync(command, { 
      maxBuffer: 1024 * 1024 * 10,
      cwd: path.resolve(__dirname, '../..')
    });
    
    if (stderr) {
      console.warn('Flow script warnings:', stderr);
    }
    
    // Parse the JSON result from the Flow script output
    // The output format is: "Result: {...}"
    let jsonResult = stdout.match(/Result:\s*(\{[\s\S]*\})/);
    
    if (!jsonResult) {
      // Try to find JSON in the output (look for the last JSON object)
      const jsonMatches = stdout.match(/\{[\s\S]*\}/g);
      if (jsonMatches && jsonMatches.length > 0) {
        jsonResult = [null, jsonMatches[jsonMatches.length - 1]];
      } else {
        throw new Error('Could not parse Flow script output');
      }
    }
    
    const result = JSON.parse(jsonResult[1]);
    
    return res.json({
      success: true,
      data: result,
      address: flowAddress
    });
    
  } catch (error) {
    console.error('Error fetching user supply:', error);
    return res.status(500).json({
      error: 'Failed to fetch user supply',
      details: error.message
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Get pool data endpoint
 */
app.get('/api/pool/data', async (req, res) => {
  try {
    const scriptPath = path.resolve(__dirname, '../../cadence/scripts/poolData.cdc');
    const command = `flow scripts execute ${scriptPath} --network testnet`;

    console.log(`Executing: ${command}`);

    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 1024 * 1024 * 10,
      cwd: path.resolve(__dirname, '../..')
    });

    if (stderr) {
      console.warn('Flow script warnings:', stderr);
    }

    // Parse JSON-like structure from Flow CLI output
    let jsonResult = stdout.match(/Result:\s*(\{[\s\S]*\})/);
    if (!jsonResult) {
      const jsonMatches = stdout.match(/\{[\s\S]*\}/g);
      if (jsonMatches && jsonMatches.length > 0) {
        jsonResult = [null, jsonMatches[jsonMatches.length - 1]];
      }
    }

    if (!jsonResult) {
      throw new Error('Could not parse Flow script output for pool data');
    }

    // The Flow map may not be strictly JSON; attempt a safe conversion
    let parsed;
    try {
      parsed = JSON.parse(jsonResult[1]);
    } catch (_) {
      // Best-effort conversions: replace UFix64-like numbers in quotes
      const normalized = jsonResult[1]
        .replace(/UFix64\(/g, '')
        .replace(/\)/g, '')
        .replace(/([\{,]\s*"[^"]+"\s*:\s*)([\d.]+)(\s*[\}\,])/g, '$1$2$3');
      parsed = JSON.parse(normalized);
    }

    return res.json({ success: true, data: parsed });
  } catch (error) {
    console.error('Error fetching pool data:', error);
    return res.status(500).json({ error: 'Failed to fetch pool data', details: error.message });
  }
});

// ==================== SERVER STARTUP ====================

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log('========================================');
  console.log(`🚀 Chrono Backend Server Running`);
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌐 Testnet Address: ${TESTNET_ADDRESS}`);
  console.log('========================================');
  console.log('Available endpoints:');
  console.log('  POST /api/faucet - Mint 100 WETH');
  console.log('  POST /api/vault/update - Update vault data');
  console.log('  GET  /api/vault/data - Get vault data');
  console.log('  GET  /api/user/supply/:address - Get user supply by token');
  console.log('  GET  /api/pool/data - Get pool data');
  console.log('  GET  /health - Health check');
  console.log('========================================');
  
  // Update vault data on startup
  try {
    console.log('\n🔄 Updating vault data on startup...');
    await updateVaultData();
  } catch (error) {
    console.error('⚠️  Failed to update vault data on startup:', error.message);
  }
});

