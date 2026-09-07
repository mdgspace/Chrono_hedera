import { ethers } from 'ethers';
import { config } from '../config/index.js';
import { supabase } from '../db/supabase.js';
import { BORROW_VAULT_ABI, LIQUIDATION_ENGINE_ABI, getBorrowVault } from '../config/contracts.js';

let cursorTimestamp = null;
const borrowVaultIface = new ethers.Interface(BORROW_VAULT_ABI);
const liqIface = new ethers.Interface(LIQUIDATION_ENGINE_ABI);

async function indexPosition(borrowVault, positionId) {
  if (!supabase) return;
  try {
    const pos = await borrowVault.getPosition(positionId);
    if (pos.borrower === ethers.ZeroAddress) return;

    await supabase.from('positions').upsert({
      position_id: positionId,
      borrower: pos.borrower,
      collateral_token: pos.collateralToken,
      debt_token: pos.debtToken,
      collateral_amount: pos.collateralAmount.toString(),
      borrow_amount: pos.borrowAmount.toString(),
      start_time: Number(pos.startTime),
      duration: Number(pos.duration),
      active: pos.active,
      updated_at: new Date().toISOString()
    }, { onConflict: 'position_id' });
  } catch (err) {
    console.warn(`Error indexing position ${positionId}:`, err.message);
  }
}

export async function syncPositions() {
  if (!supabase) return;
  try {
    const provider = new ethers.JsonRpcProvider(config.HEDERA_TESTNET_RPC);
    const borrowVault = getBorrowVault(provider);
    const nextPosId = await borrowVault.nextPositionId();
    const numPositions = Number(nextPosId);

    for (let i = 1; i < numPositions; i++) {
      const positionId = ethers.zeroPadValue(ethers.toBeHex(i), 32);
      const { data } = await supabase
        .from('positions')
        .select('position_id')
        .eq('position_id', positionId)
        .maybeSingle();

      if (!data) {
        await indexPosition(borrowVault, positionId);
      }
    }
  } catch (err) {
    console.warn("Position bootstrap sync warning:", err.message);
  }
}

export async function pollPositionEvents() {
  if (!supabase) return;
  const vaultAddress = config.addresses.BorrowVault;
  const liqAddress = config.addresses.LiquidationEngine;
  if (!vaultAddress) return;

  try {
    const provider = new ethers.JsonRpcProvider(config.HEDERA_TESTNET_RPC);
    const borrowVault = getBorrowVault(provider);

    // Poll BorrowVault events
    let vaultUrl = `https://testnet.mirrornode.hedera.com/api/v1/contracts/${vaultAddress}/results/logs?order=asc&limit=100`;
    if (cursorTimestamp) {
      vaultUrl += `&timestamp=gt:${cursorTimestamp}`;
    }

    const res = await fetch(vaultUrl);
    if (res.ok) {
      const data = await res.json();
      const logs = data.logs || [];

      for (const log of logs) {
        try {
          const topics = [log.topic0, log.topic1, log.topic2, log.topic3].filter(Boolean);
          if (topics.length === 0) continue;
          const parsed = borrowVaultIface.parseLog({ topics, data: log.data });
          if (!parsed) continue;

          if (['PositionOpened', 'Repaid', 'CollateralToppedUp'].includes(parsed.name)) {
            await indexPosition(borrowVault, parsed.args.positionId);
          }
          cursorTimestamp = log.timestamp;
        } catch (e) {}
      }
    }

    // Poll LiquidationEngine events if configured
    if (liqAddress) {
      let liqUrl = `https://testnet.mirrornode.hedera.com/api/v1/contracts/${liqAddress}/results/logs?order=asc&limit=100`;
      if (cursorTimestamp) {
        liqUrl += `&timestamp=gt:${cursorTimestamp}`;
      }
      const liqRes = await fetch(liqUrl);
      if (liqRes.ok) {
        const liqData = await liqRes.json();
        const liqLogs = liqData.logs || [];
        for (const log of liqLogs) {
          try {
            const topics = [log.topic0, log.topic1, log.topic2, log.topic3].filter(Boolean);
            if (topics.length === 0) continue;
            const parsed = liqIface.parseLog({ topics, data: log.data });
            if (!parsed) continue;

            if (parsed.name === 'SoftLiquidation' || parsed.name === 'HardLiquidation') {
              await indexPosition(borrowVault, parsed.args.positionId);
            }
          } catch (e) {}
        }
      }
    }
  } catch (err) {
    console.warn("Position indexer polling error:", err.message);
  }
}

export function startPositionIndexer() {
  syncPositions().then(() => {
    pollPositionEvents();
  });
  setInterval(pollPositionEvents, 30000);
}
