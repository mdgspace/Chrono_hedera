CREATE TABLE IF NOT EXISTS positions (
  position_id       TEXT PRIMARY KEY,
  borrower          TEXT NOT NULL,
  collateral_token  TEXT NOT NULL,
  debt_token        TEXT NOT NULL,
  collateral_amount NUMERIC NOT NULL,
  borrow_amount     NUMERIC NOT NULL,
  start_time        BIGINT NOT NULL,
  duration          BIGINT NOT NULL,
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_active ON positions(active);
CREATE INDEX IF NOT EXISTS idx_pos_debt_token ON positions(debt_token);
CREATE INDEX IF NOT EXISTS idx_pos_borrower ON positions(borrower);
