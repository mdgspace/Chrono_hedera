CREATE TABLE IF NOT EXISTS liquidation_events (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tx_hash             TEXT NOT NULL UNIQUE,
  block_number        BIGINT,
  timestamp           TIMESTAMPTZ NOT NULL,
  type                TEXT NOT NULL CHECK (type IN ('soft', 'hard')),
  position_id         TEXT NOT NULL,
  debt_token          TEXT NOT NULL,
  collateral_token    TEXT NOT NULL,
  debt_amount         NUMERIC NOT NULL,
  collateral_seized   NUMERIC NOT NULL,
  liquidator          TEXT,
  pool                TEXT NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_liq_pool ON liquidation_events(pool);
CREATE INDEX IF NOT EXISTS idx_liq_timestamp ON liquidation_events(timestamp);

CREATE TABLE IF NOT EXISTS tvl_snapshots (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  timestamp   TIMESTAMPTZ NOT NULL,
  total_tvl   NUMERIC NOT NULL,
  per_asset   JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tvl_timestamp ON tvl_snapshots(timestamp);
