import { ethers } from 'ethers';
import { config } from '../config/index.js';
import { supabase } from '../db/supabase.js';
import { LIQUIDATION_ENGINE_ABI } from '../config/contracts.js';

let cursorTimestamp = null;
const iface = new ethers.Interface(LIQUIDATION_ENGINE_ABI);

export async function pollLiquidationEvents() {
  if (!supabase) {
    console.warn("Supabase not configured, skipping indexer.");
    return;
  }

  try {
    const engineAddress = config.addresses.LiquidationEngine;
    let url = `https://testnet.mirrornode.hedera.com/api/v1/contracts/${engineAddress}/results/logs?order=asc&limit=100`;
    
    if (cursorTimestamp) {
      url += `&timestamp=gt:${cursorTimestamp}`;
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Mirror Node HTTP error: ${res.status}`);
    const data = await res.json();
    
    const logs = data.logs || [];
    if (logs.length === 0) return;

    for (const log of logs) {
      try {
        const topics = [log.topic0, log.topic1, log.topic2, log.topic3].filter(Boolean);
        const parsed = iface.parseLog({ topics, data: log.data });
        if (!parsed) continue;

        const isSoft = parsed.name === 'SoftLiquidation';
        const isHard = parsed.name === 'HardLiquidation';

        if (!isSoft && !isHard) continue;

        const positionId = parsed.args.positionId;
        const liquidator = isSoft ? parsed.args.liquidator : null;
        const debtRepaid = parsed.args.debtRepaid.toString();
        const collateralSeized = parsed.args.collateralSeized.toString();

        // Optional: fetch position details from mirror node to get pool/debt_token/collateral_token
        // Or default since the event doesn't emit it directly. MVP: hardcode wUSDC for pool if needed
        // but we should ideally know the pool. The plan states: pool e.g. "wUSDC".
        // For MVP, we will set pool="wUSDC", debt_token="wUSDC", collateral_token="wETH".
        
        await supabase.from('liquidation_events').upsert({
          tx_hash: log.transaction_hash,
          timestamp: new Date(parseFloat(log.timestamp) * 1000).toISOString(),
          type: isSoft ? 'soft' : 'hard',
          position_id: positionId,
          debt_token: 'wUSDC', // MVP fallback
          collateral_token: 'wETH', // MVP fallback
          debt_amount: debtRepaid,
          collateral_seized: collateralSeized,
          liquidator: liquidator,
          pool: 'wUSDC'
        }, { onConflict: 'tx_hash' });

        cursorTimestamp = log.timestamp;
      } catch (err) {
        console.warn('Error parsing log', err);
      }
    }
  } catch (error) {
    console.error("Indexer error:", error);
  }
}

export function startIndexer() {
  pollLiquidationEvents();
  setInterval(pollLiquidationEvents, 60000);
}
