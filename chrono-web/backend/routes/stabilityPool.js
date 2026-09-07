import express from 'express';
import { fetchStabilityPoolData } from '../services/stabilityPoolData.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const data = await fetchStabilityPoolData();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get('/data', async (req, res, next) => {
  try {
    const data = await fetchStabilityPoolData();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

export default router;
