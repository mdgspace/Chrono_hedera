import express from 'express';
import { fetchVaultData } from '../services/vaultData.js';

const router = express.Router();

router.get('/vault/data', async (req, res, next) => {
  try {
    const data = await fetchVaultData();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get('/protocol/tvl', async (req, res, next) => {
  try {
    // This will be linked to Supabase tvl_snapshots in Phase 6
    // For now, return empty or mock
    res.json([]);
  } catch (error) {
    next(error);
  }
});

export default router;
