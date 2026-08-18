import express from 'express';
import { getVolatility } from '../services/volatility.js';

const router = express.Router();

router.get('/volatility', (req, res) => {
  const asset = req.query.asset;
  if (!asset) {
    return res.status(400).json({ error: 'Missing asset parameter' });
  }

  const volatility = getVolatility(asset);
  res.json(volatility);
});

export default router;
