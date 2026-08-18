# Chrono Protocol Backend

The Node.js backend for Chrono Protocol, a decentralized lending protocol on Hedera.

## Features
- **Vault Data Aggregation**: Queries Hedera Smart Contracts (LendingPool, BorrowVault, RiskEngine, AssetRegistry) to compute TVL, total borrowed, utilization, and position health.
- **Liquidation Indexer**: Polls Hedera Mirror Node logs for `SoftLiquidation` and `HardLiquidation` events, tracking them in Supabase.
- **TVL Snapshotter**: Periodically snapshots protocol TVL into Supabase.
- **Hedera Testnet Faucet**: Issues wETH, wUSDC, and wBTC to users via backend-signed transactions using `ethers.js`.

## Setup

1. Copy `.env.example` to `.env` in the root folder, or ensure the root `.env` exists:
   ```
   HEDERA_TESTNET_RPC=https://testnet.hashio.io/api
   HEDERA_MIRROR_NODE=https://testnet.mirrornode.hedera.com
   TESTNET_PRIVATE_KEY=your_ecdsa_private_key_for_faucet
   TESTNET_ACCOUNT_ID=0.0.x
   SUPABASE_URL=https://xyz.supabase.co
   SUPABASE_ANON_KEY=eyJ...
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run locally:
   ```bash
   npm start
   ```

## Database Initialization (Supabase)

The backend requires the following tables in your Supabase project. You can run the SQL script located at `db/migrations/01_init.sql` in the Supabase SQL Editor.
- `liquidation_events`
- `tvl_snapshots`

## API Routes (v1)

- **GET `/api/v1/protocol/vault/data`**
  Returns aggregated vault stats (TVL, Utilization, Available Liquidity) and protocol-wide position metrics.
- **GET `/api/v1/pool/data`**
  Returns standard pool list.
- **GET `/api/v1/markets/volatility?asset=wETH`**
  Returns hardcoded 30-day volatility per asset (MVP).
- **POST `/api/v1/faucet/mint`**
  Mint testnet tokens to a wallet. Payload: `{ "wallet": "0x...", "asset": "wETH" }`
- **GET `/api/v1/liquidations/history?pool=wUSDC`**
  Fetch liquidation history from Supabase index.

## Hedera Gotchas
- **HTS Associations**: The faucet will fail with `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT` if the recipient wallet has not explicitly signed an association transaction for wETH/wUSDC/wBTC prior to requesting the drip.
- **RPC Stability**: `hashio` public RPC can sometimes rate-limit or fail `eth_estimateGas`.
- **EVM vs Native**: Protocol interactions happen via EVM (ethers.js), but some state (like Token Associations) requires the Hiero SDK (`@hiero-ledger/sdk`).

## Deployment (Render / Railway)

1. Connect your GitHub repository to Render/Railway.
2. Select the `chrono-web/backend` directory as the Root Directory.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Inject Environment Variables (copy from `.env`).
