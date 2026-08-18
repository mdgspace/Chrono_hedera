import { supabase } from '../db/supabase.js';
import { fetchVaultData } from './vaultData.js';

export async function snapshotTVL() {
  if (!supabase) {
    console.warn("Supabase not configured, skipping TVL snapshot.");
    return;
  }

  try {
    const data = await fetchVaultData();
    const timestamp = new Date().toISOString();
    const total_tvl = data.protocolStats.totalValueLocked;
    
    const per_asset = {};
    for (const vault of data.vaults) {
      per_asset[vault.symbol] = {
        deposited: vault.totalDeposited,
        price: vault.price,
        tvl_usd: vault.totalDepositedUSD
      };
    }

    await supabase.from('tvl_snapshots').insert({
      timestamp,
      total_tvl,
      per_asset
    });

    console.log(`TVL Snapshot saved: $${total_tvl} at ${timestamp}`);
  } catch (err) {
    console.error("TVL Snapshot error:", err);
  }
}

export function startSnapshotter() {
  snapshotTVL();
  setInterval(snapshotTVL, 60 * 60 * 1000); // 1 hour
}
