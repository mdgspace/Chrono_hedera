import express from 'express';
import { fetchVaultData } from '../services/vaultData.js';

const router = express.Router();

router.get('/data', async (req, res, next) => {
  try {
    const data = await fetchVaultData();
    res.json({ pools: data.vaults });
  } catch (error) {
    next(error);
  }
});

export default router;
