import express from 'express';
import { mintTokens } from '../services/faucet.js';

const router = express.Router();

router.post('/mint', async (req, res, next) => {
  try {
    const { wallet, asset } = req.body;
    
    if (!wallet || !asset) {
      return res.status(400).json({ error: 'Missing wallet or asset' });
    }

    const result = await mintTokens(wallet, asset);
    res.json(result);
  } catch (error) {
    next(error); // Pass to centralized error handler (Phase 7)
  }
});

export default router;
