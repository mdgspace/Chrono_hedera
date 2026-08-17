# Chrono Backend API

## Overview
The Chrono Backend handles:
- **Faucet**: Mints 100 WETH to user addresses on testnet
- **Vault Data Updates**: Fetches and updates protocol vault data from Flow blockchain
- **API Endpoints**: RESTful API for frontend integration

## Setup

### Install Dependencies
```bash
cd chrono-web/backend
npm install
```

### Start the Server

**Production Mode:**
```bash
npm start
```

**Development Mode (with auto-reload):**
```bash
npm run dev
```

The server will start on `http://localhost:3001`

## API Endpoints

### POST /api/faucet
Mints 100 WETH to a specified Flow address.

**Request:**
```json
{
  "address": "0x1234567890abcdef"
}
```

**Response (Success):**
```json
{
  "success": true,
  "transactionId": "abc123...",
  "message": "Successfully minted 100 WETH!"
}
```

### POST /api/vault/update
Triggers an update of vault data from the Flow blockchain.

**Response:**
```json
{
  "success": true,
  "data": { /* vault data */ },
  "message": "Vault data updated successfully"
}
```

### GET /api/vault/data
Returns the current vault data.

**Response:**
```json
{
  "timestamp": "2025-10-30T...",
  "lastUpdate": 1730000000000,
  "protocolStats": {
    "totalValueLocked": 1234567.89,
    "totalBorrowed": 123456.78,
    "activeLendingPositions": 10,
    "activeBorrowingPositions": 5,
    "unhealthyPositions": 0,
    "overduePositions": 0
  },
  "vaults": [ /* array of vault objects */ ]
}
```

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-10-30T..."
}
```

## Features

### Auto-Update on Startup
The server automatically updates vault data when it starts.

### Flow Testnet Integration
- Uses testnet account for faucet transactions
- Reads private key from `../../raptor.pkey`
- Executes Flow CLI scripts for vault data

### CORS Enabled
The server has CORS enabled for frontend integration.

## Environment

- **Network**: Flow Testnet
- **Testnet Account**: `0xe11cab85e85ae137`
- **Port**: 3001 (configurable via `PORT` env variable)

## File Structure

```
chrono-web/backend/
├── server.js          # Main Express server
├── package.json       # Node.js dependencies
└── README.md          # This file
```

## Dependencies

- `express` - Web framework
- `cors` - CORS middleware
- `@onflow/fcl` - Flow Client Library
- `sha3` - Cryptographic signing
- `elliptic` - Elliptic curve cryptography

## Troubleshooting

### Port Already in Use
```bash
# Find process using port 3001
lsof -i :3001  # Mac/Linux
netstat -ano | findstr :3001  # Windows

# Kill the process and restart
```

### Private Key Not Found
Ensure `raptor.pkey` exists in the project root with the testnet private key.

### Flow CLI Not Found
Install Flow CLI:
```bash
sh -ci "$(curl -fsSL https://raw.githubusercontent.com/onflow/flow-cli/master/install.sh)"
```

### Vault Update Fails
- Check Flow testnet status
- Verify `cadence/scripts/vaultDataScript.cdc` exists
- Ensure Flow CLI is installed and accessible








